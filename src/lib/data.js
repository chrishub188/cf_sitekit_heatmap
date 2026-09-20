// Heatmap cell data. Loads a grid of PET readings from the EnvGrid API (see
// gridSource.js), keeps it in typed arrays, and selects the cells inside the
// radial clip whenever the centre moves.
//
// A grid arrives as a struct-of-arrays: coordinates already in EPSG:4326, one
// cell basis for the whole grid. This module never knows where it came from;
// it takes a `source` descriptor — `{ key, center, radius, load }` — which is
// the seam another kind of grid would be added at.
//
// Everything that doesn't depend on the visitor's position is done once: the
// grid coordinates arrive ready to use, the excluded/invalid mask is
// precomputed, and each cell's polygon is built on first use and then reused
// for as long as the grid is cached. A clip update is therefore a distance
// scan over two Float64Arrays plus a list of references — no reprojection, no
// parsing, and no geometry construction once the visitor has covered ground.
// That matters because the clip centre follows a live position feed: at ~5 Hz
// the old rebuild-everything path saturated the main thread on its own.
//
// Two things the static-only version didn't need:
//
//  - The cache is bounded. Its keys used to be three fixed file paths; with a
//    live API they follow the visitor, and the real weight is the built
//    polygons hanging off each entry (~1 KB per feature), so old grids have to
//    be let go.
//  - A load no longer blocks the clip. While a new grid is on its way, the one
//    already in hand keeps being clipped against the visitor's real position,
//    as long as it still reaches that far; the new one is swapped in when it
//    lands. The layer is never emptied just because the network is slow — but
//    it is emptied once the grid we hold no longer covers where the visitor
//    is, since there is no other data to fall back to.
//
// Cell colour is deliberately *not* baked in here — Heatmap.svelte colours by
// `pet` with a MapLibre paint expression, which is what keeps these features
// constant and cacheable.
//
// A factory rather than a single module-level store: each caller gets its own
// cache, so a Heatmap component owns its data independently of any other.
// Heatmap.svelte owns applying the result to MapLibre; this module only knows
// how to produce a GeoJSON FeatureCollection.

import { metresBetween } from './envGrid.js';

/** @typedef {[number, number]} LngLat */
/** @typedef {{ax: number, ay: number, bx: number, by: number}} CellBasis */
/** Raw grid, as envGrid.js emits it.
 * @typedef {{cell: CellBasis, lng: number[], lat: number[], pet: (number|null)[], ntzg?: (number|null)[], center?: LngLat|null, radius?: number, sessionId?: string|null}} RawGrid */
/** Where a grid comes from — see gridSource.js.
 * @typedef {{key: string, center: LngLat|null, radius: number, load: () => Promise<RawGrid|null>}} GridSource */
/** @typedef {{gap: number, roundness: number, excludeNtzg: number[]}} ClipOptions */
/** @typedef {{type: 'Feature', properties: {filtered: boolean, pet?: number}, geometry: {type: 'Polygon', coordinates: number[][][]}}} CellFeature */
/** A loaded grid, ready to clip.
 * @typedef {{key: string, center: LngLat|null, radius: number, sessionId: string|null, lng: Float64Array, lat: Float64Array, pet: Float64Array, filtered: Uint8Array, offsets: number[][], features: (CellFeature|undefined)[]}} Entry */

// Vertices per cell outline. Every one of the ~7850 cells inside the clip is
// re-triangulated and re-filled on each repaint, so this multiplies straight
// into the draw cost — and a cell is well under a metre across on screen,
// where the corner rounding reads the same at half the resolution.
const ROUND_SEGMENTS = 12;
const M_PER_DEG = 111320;

// Grids kept at once. Small on purpose: an entry whose clip disc has been
// fully traversed carries tens of MB of built polygons, and dropping the entry
// is what frees them. Enough to walk out of a grid and back without refetching.
const MAX_ENTRIES = 4;

const EMPTY = { type: 'FeatureCollection', features: [] };

// Unit superellipse sampled once; each cell reuses it via an affine map (below).
const unitShape = (/** @type {number} */ n) =>
	Array.from({ length: ROUND_SEGMENTS }, (_, i) => {
		const theta = (i / ROUND_SEGMENTS) * Math.PI * 2;
		const c = Math.cos(theta);
		const s = Math.sin(theta);
		return [Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(s) * Math.abs(s) ** (2 / n)];
	});

// The ring of one cell, expressed as offsets in degrees from its centre. The
// grid is regular and the half-basis vectors (`cell`) are constant across a
// grid, so this shape is identical for every cell — building a cell then costs
// one addition per vertex.
function ringOffsets(/** @type {CellBasis} */ cell, /** @type {number} */ gap, /** @type {number} */ roundness) {
	const [ax, ay] = [cell.ax * gap, cell.ay * gap];
	const [bx, by] = [cell.bx * gap, cell.by * gap];
	const offsets = unitShape(roundness).map(([sx, sy]) => [sx * ax + sy * bx, sx * ay + sy * by]);
	offsets.push(offsets[0]); // close the ring
	return offsets;
}

// Built on first use and cached — see the note at the top of the file.
function featureAt(/** @type {Entry} */ entry, /** @type {number} */ i) {
	const cached = entry.features[i];
	if (cached) return cached;

	const cx = entry.lng[i];
	const cy = entry.lat[i];
	const { offsets } = entry;
	const ring = new Array(offsets.length);
	for (let k = 0; k < offsets.length; k++) ring[k] = [cx + offsets[k][0], cy + offsets[k][1]];

	const isFiltered = entry.filtered[i] === 1;
	/** @type {CellFeature} */
	const feature = {
		type: 'Feature',
		// Filtered cells carry no `pet` at all rather than a NaN: they're drawn
		// as a flat ghost tint, and the colour expression never reads it.
		properties: isFiltered ? { filtered: true } : { filtered: false, pet: entry.pet[i] },
		geometry: { type: 'Polygon', coordinates: [ring] }
	};
	entry.features[i] = feature;
	return feature;
}

// The radial clip: every cell whose centre lies within `radius` metres of
// `center`. Distances use a local equirectangular approximation rather than a
// haversine — over a 50 m radius the error is far below the 1 m grid pitch,
// and it keeps the hot loop to two multiplications per cell.
function clip(/** @type {Entry} */ entry, /** @type {LngLat} */ [clng, clat], /** @type {number} */ radius) {
	const mPerDegLng = M_PER_DEG * Math.cos((clat * Math.PI) / 180);
	const r2 = radius * radius;
	const { lng, lat } = entry;

	/** @type {CellFeature[]} */
	const features = [];
	for (let i = 0; i < lng.length; i++) {
		const dx = (lng[i] - clng) * mPerDegLng;
		const dy = (lat[i] - clat) * M_PER_DEG;
		if (dx * dx + dy * dy > r2) continue;
		features.push(featureAt(entry, i));
	}
	return features.length ? { type: 'FeatureCollection', features } : EMPTY;
}

// Whether a grid already in hand reaches everything the clip is about to ask
// for. A grid with no centre of its own is treated as covering everywhere.
function covers(/** @type {Entry|null} */ entry, /** @type {LngLat} */ center, /** @type {number} */ radius) {
	if (!entry) return false;
	if (!entry.center) return true;
	return metresBetween(entry.center, center) + radius <= entry.radius;
}

/**
 * Creates an independent heatmap data store.
 *
 * `refresh(source, center, radius, options)` returns the GeoJSON
 * FeatureCollection for the cells inside the clip; `options` is
 * { gap, roundness, excludeNtzg }, mirroring Heatmap.svelte's props.
 *
 * `onSwap` is called when a grid that was fetched in the background has landed
 * and the clip is worth rebuilding — the caller re-runs refresh, which then
 * hits the cache.
 */
export function createHeatmapData(/** @type {(() => void) | undefined} */ onSwap) {
	// key -> Promise of the loaded entry. The promise itself is cached so
	// overlapping refreshes share one fetch. Insertion order is recency: a hit
	// is deleted and re-inserted, so the first key is always the oldest.
	/** @type {Map<string, Promise<Entry|null>>} */
	const cache = new Map();

	/** The grid currently being clipped. @type {Entry|null} */
	let active = null;
	/** The key the newest refresh asked for — guards against a slow load swapping in over a newer one. @type {string|null} */
	let wanted = null;

	const cacheKey = (/** @type {GridSource} */ source, /** @type {ClipOptions} */ { gap, roundness, excludeNtzg }) =>
		`${source.key}|${gap}|${roundness}|${excludeNtzg.join(',')}`;

	function load(/** @type {GridSource} */ source, /** @type {ClipOptions} */ options) {
		const key = cacheKey(source, options);
		const hit = cache.get(key);
		if (hit) {
			cache.delete(key);
			cache.set(key, hit);
			return hit;
		}

		const entry = (async () => {
			/** @type {RawGrid | null} */
			let raw;
			try {
				raw = await source.load();
				if (!raw) return null; // no data available right now (backing off, or superseded)
			} catch (err) {
				console.warn(`heatmap data: failed to load ${source.key}`, err);
				return null;
			}

			const { gap, roundness, excludeNtzg } = options;
			const n = raw.lng.length;
			const pet = new Float64Array(n);
			const filtered = new Uint8Array(n);
			for (let i = 0; i < n; i++) {
				const value = raw.pet[i];
				pet[i] = value == null ? NaN : value;
				// Excluded land-use class, or no usable reading — either way the
				// cell is drawn as a ghost rather than coloured. Computed once
				// here instead of per cell on every clip update. (The API returns
				// no land-use class of its own; there, this is just "no reading".)
				const ntzg = raw.ntzg?.[i];
				filtered[i] = value == null || (ntzg != null && excludeNtzg.includes(ntzg)) ? 1 : 0;
			}

			return {
				key,
				// Where this grid reaches, for covers() above.
				center: raw.center ?? null,
				radius: raw.radius ?? Infinity,
				sessionId: raw.sessionId ?? null,
				lng: Float64Array.from(raw.lng),
				lat: Float64Array.from(raw.lat),
				pet,
				filtered,
				offsets: ringOffsets(raw.cell, gap, roundness),
				features: new Array(n)
			};
		})();

		cache.set(key, entry);
		if (cache.size > MAX_ENTRIES) cache.delete(/** @type {string} */ (cache.keys().next().value));

		// A failed or aborted load must not be remembered as "this grid is
		// empty" — drop it so the next attempt actually retries.
		entry.then((value) => {
			if (!value && cache.get(key) === entry) cache.delete(key);
		});

		return entry;
	}

	const emit = (/** @type {LngLat} */ center, /** @type {number} */ radius) =>
		active ? clip(active, center, radius) : EMPTY;

	/**
	 * @param {GridSource} source
	 * @param {LngLat} center
	 * @param {number} radius
	 * @param {ClipOptions} options
	 */
	async function refresh(source, center, radius, options) {
		const key = cacheKey(source, options);
		wanted = key;

		// Already the grid in hand: just re-clip.
		if (active?.key === key) return emit(center, radius);

		const pending = load(source, options);

		// What we have still reaches far enough — keep drawing from it and let
		// the new grid arrive in its own time.
		if (covers(active, center, radius)) {
			pending.then((entry) => {
				if (!entry || wanted !== key || active?.key === key) return;
				active = entry;
				onSwap?.();
			});
			return emit(center, radius);
		}

		const entry = await pending;
		if (entry && wanted === key) {
			active = entry;
		} else if (!covers(active, center, radius)) {
			// The load produced nothing and what we still hold doesn't reach
			// this far. Let it go: an empty overlay is honest, a disc drawn
			// half from a grid that ends mid-screen is not.
			active = null;
		}
		return emit(center, radius);
	}

	return { refresh };
}
