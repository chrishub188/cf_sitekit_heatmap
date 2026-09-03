// Heatmap cell data. Loads a site's prepared 1x1m grid (EPSG:4326 — already
// reprojected by scripts/prepare-data.js, see `npm run prepare:data`) once per
// url and keeps it in typed arrays, then selects the cells inside the radial
// clip whenever the centre moves.
//
// Everything that doesn't depend on the visitor's position is done once:
// the grid coordinates arrive ready to use, the excluded/invalid mask is
// precomputed, and each cell's polygon is built on first use and then reused
// for the life of the store. A clip update is therefore a distance scan over
// two Float64Arrays plus a list of references — no reprojection, no CSV
// parsing, and no geometry construction once the visitor has covered ground.
// That matters because the clip centre follows a live position feed: at ~5 Hz
// the old rebuild-everything path saturated the main thread on its own.
//
// Cell colour is deliberately *not* baked in here — Heatmap.svelte colours by
// `pet` with a MapLibre paint expression, which is what keeps these features
// constant and cacheable.
//
// A factory rather than a single module-level store: each caller gets its
// own url cache and subscriber set, so a Heatmap component owns its data
// independently of any other. Heatmap.svelte owns applying the result to
// MapLibre; this module only knows how to produce a GeoJSON FeatureCollection.

import { writable } from 'svelte/store';

// Vertices per cell outline. Every one of the ~7850 cells inside the clip is
// re-triangulated and re-filled on each repaint, so this multiplies straight
// into the draw cost — and a cell is well under a metre across on screen,
// where the corner rounding reads the same at half the resolution.
const ROUND_SEGMENTS = 12;
const M_PER_DEG = 111320;

// Unit superellipse sampled once; each cell reuses it via an affine map (below).
const unitShape = (n) =>
	Array.from({ length: ROUND_SEGMENTS }, (_, i) => {
		const theta = (i / ROUND_SEGMENTS) * Math.PI * 2;
		const c = Math.cos(theta);
		const s = Math.sin(theta);
		return [Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(s) * Math.abs(s) ** (2 / n)];
	});

// The ring of one cell, expressed as offsets in degrees from its centre. The
// grid is regular and the half-basis vectors (`cell`, computed at build time)
// are constant across a site, so this shape is identical for every cell —
// building a cell then costs one addition per vertex.
function ringOffsets(cell, gap, roundness) {
	const [ax, ay] = [cell.ax * gap, cell.ay * gap];
	const [bx, by] = [cell.bx * gap, cell.by * gap];
	const offsets = unitShape(roundness).map(([sx, sy]) => [sx * ax + sy * bx, sx * ay + sy * by]);
	offsets.push(offsets[0]); // close the ring
	return offsets;
}

// Built on first use and cached — see the note at the top of the file.
function featureAt(entry, i) {
	const cached = entry.features[i];
	if (cached) return cached;

	const cx = entry.lng[i];
	const cy = entry.lat[i];
	const { offsets } = entry;
	const ring = new Array(offsets.length);
	for (let k = 0; k < offsets.length; k++) ring[k] = [cx + offsets[k][0], cy + offsets[k][1]];

	const isFiltered = entry.filtered[i] === 1;
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
function clip(entry, [clng, clat], radius) {
	const mPerDegLng = M_PER_DEG * Math.cos((clat * Math.PI) / 180);
	const r2 = radius * radius;
	const { lng, lat } = entry;

	const features = [];
	for (let i = 0; i < lng.length; i++) {
		const dx = (lng[i] - clng) * mPerDegLng;
		const dy = (lat[i] - clat) * M_PER_DEG;
		if (dx * dx + dy * dy > r2) continue;
		features.push(featureAt(entry, i));
	}
	return features.length ? { type: 'FeatureCollection', features } : null;
}

// Creates an independent heatmap data store. `refresh(url, center, radius,
// options)` loads (once per url + options) and pushes the resulting GeoJSON
// FeatureCollection (or null) to subscribers; `options` is
// { gap, roundness, excludeNtzg }, mirroring Heatmap.svelte's props.
export function createHeatmapData() {
	const { subscribe, set } = writable(null);
	// url + options -> Promise of the prepared entry. The promise itself is
	// cached so overlapping refreshes share one fetch.
	const cache = new Map();

	function load(url, { gap, roundness, excludeNtzg }) {
		const key = `${url}|${gap}|${roundness}|${excludeNtzg.join(',')}`;
		const hit = cache.get(key);
		if (hit) return hit;

		const entry = (async () => {
			/** @type {{cell: {ax: number, ay: number, bx: number, by: number}, lng: number[], lat: number[], pet: (number|null)[], ntzg?: (number|null)[]}} */
			let raw;
			try {
				const res = await fetch(url);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				raw = await res.json();
			} catch (err) {
				console.warn(`heatmap data: failed to load ${url}`, err);
				return null;
			}

			const n = raw.lng.length;
			const pet = new Float64Array(n);
			const filtered = new Uint8Array(n);
			for (let i = 0; i < n; i++) {
				const value = raw.pet[i];
				pet[i] = value == null ? NaN : value;
				// Excluded land-use class, or no usable reading — either way the
				// cell is drawn as a ghost rather than coloured. Computed once
				// here instead of per cell on every clip update.
				const ntzg = raw.ntzg?.[i];
				filtered[i] = value == null || (ntzg != null && excludeNtzg.includes(ntzg)) ? 1 : 0;
			}

			return {
				lng: Float64Array.from(raw.lng),
				lat: Float64Array.from(raw.lat),
				pet,
				filtered,
				offsets: ringOffsets(raw.cell, gap, roundness),
				features: new Array(n)
			};
		})();

		cache.set(key, entry);
		return entry;
	}

	async function refresh(url, center, radius, options) {
		const entry = await load(url, options);
		const geojson = entry ? clip(entry, center, radius) : null;
		set(geojson);
		return geojson;
	}

	return { subscribe, refresh };
}
