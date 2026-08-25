// Heatmap cell data. Fetches a site's 1x1m CSV (EPSG:25832, reprojected
// client-side) once per url and caches it, then rebuilds the radial-clip
// GeoJSON whenever center/radius (or the other styling knobs) change —
// refiltering in-memory rows is cheap, a network fetch + CSV parse on every
// location update would not be.
//
// A factory rather than a single module-level store: each caller gets its
// own url cache and subscriber set, so a Heatmap component owns its data
// independently of any other. Heatmap.svelte owns applying the result to
// MapLibre; this module only knows how to produce a GeoJSON FeatureCollection.

import { writable } from 'svelte/store';
import { scaleSequential, interpolateRdYlBu } from 'd3';
import proj4 from 'proj4';

const ROUND_SEGMENTS = 24;
const FILTERED_COLOR = '#141414'; // faint ghost tint for excluded/invalid cells — no stroke, so the map stays visible
const FILTERED_OPACITY = 0.025;
const EARTH_RADIUS = 6371000; // metres

// ETRS89 / UTM zone 32N — covers both sites (Mannheim, Kaiserslautern).
const EPSG25832 = '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const project = (x, y) => proj4(EPSG25832, 'WGS84', [x, y]);

// Unit superellipse sampled once; each cell reuses it via an affine map (below).
const unitShape = (n) =>
	Array.from({ length: ROUND_SEGMENTS }, (_, i) => {
		const theta = (i / ROUND_SEGMENTS) * Math.PI * 2;
		const c = Math.cos(theta);
		const s = Math.sin(theta);
		return [Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(s) * Math.abs(s) ** (2 / n)];
	});

// Great-circle distance between two lon/lat points, in metres.
function haversine(lng1, lat1, lng2, lat2) {
	const toRad = (d) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
}

function parseCsv(text) {
	const lines = text.trim().split(/\r?\n/);
	if (lines.length < 2) return [];
	const header = lines[0].split(',').map((h) => h.trim());
	const xi = header.indexOf('x');
	const yi = header.indexOf('y');
	const peti = header.indexOf('pet') !== -1 ? header.indexOf('pet') : header.indexOf('value');
	const ntzgi = header.indexOf('ntzg'); // absent in newer datasets — stays -1, r.ntzg stays NaN
	return lines
		.slice(1)
		.map((line) => {
			const cols = line.split(',');
			return {
				x: parseFloat(cols[xi]),
				y: parseFloat(cols[yi]),
				pet: parseFloat(cols[peti]),
				ntzg: parseInt(cols[ntzgi], 10)
			};
		})
		.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y));
}

function buildGeoJson(rows, anchor, center, radius, { pitch, gap, roundness, excludeNtzg }) {
	if (rows.length === 0 || !anchor) return null;

	const isFiltered = (r) => excludeNtzg.includes(r.ntzg) || !Number.isFinite(r.pet);
	const [clng, clat] = center;
	const inRadius = (r) => haversine(r.x, r.y, clng, clat) <= radius;

	const included = rows.filter((r) => !isFiltered(r) && inRadius(r));
	const filtered = rows.filter((r) => isFiltered(r) && inRadius(r));
	if (included.length === 0 && filtered.length === 0) return null;

	// The 1 m dataset is a known regular grid (pitch metres, axis-aligned in
	// UTM) but isn't guaranteed to be written in any particular row order, so
	// the pitch vectors are derived analytically by reprojecting a probe
	// offset near the data rather than inferred from row-to-row deltas.
	const [ax, ay] = project(anchor.x, anchor.y);
	const [adx, ady] = project(anchor.x + pitch, anchor.y);
	const [bdx, bdy] = project(anchor.x, anchor.y + pitch);
	const Ah = { x: ((adx - ax) / 2) * gap, y: ((ady - ay) / 2) * gap };
	const Bh = { x: ((bdx - ax) / 2) * gap, y: ((bdy - ay) / 2) * gap };
	const shape = unitShape(roundness);

	const pets = included.map((r) => r.pet);
	const min = pets.length ? Math.min(...pets) : null;
	const max = pets.length ? Math.max(...pets) : null;
	// Domain reversed ([max, min]) so higher PET maps to the interpolator's red end.
	const color =
		min != null && max != null && max > min
			? scaleSequential(interpolateRdYlBu).domain([max, min])
			: () => interpolateRdYlBu(0.5);

	const toFeature = (r, cellColor, isFilteredCell) => {
		const cx = r.x;
		const cy = r.y;
		const ring = shape.map(([sx, sy]) => [cx + sx * Ah.x + sy * Bh.x, cy + sx * Ah.y + sy * Bh.y]);
		ring.push(ring[0]);
		return {
			type: 'Feature',
			properties: { pet: r.pet, color: cellColor, filtered: isFilteredCell },
			geometry: { type: 'Polygon', coordinates: [ring] }
		};
	};

	const features = [
		...included.map((r) => toFeature(r, color(r.pet), false)),
		...filtered.map((r) => toFeature(r, FILTERED_COLOR, true))
	];

	return { type: 'FeatureCollection', features };
}

// Creates an independent heatmap data store. `refresh(url, center, radius,
// options)` fetches/parses (once per url) and pushes the resulting GeoJSON
// FeatureCollection (or null) to subscribers; `options` is
// { pitch, gap, roundness, excludeNtzg }, mirroring Heatmap.svelte's props.
export function createHeatmapData() {
	const { subscribe, set } = writable(null);
	const rowsCache = new Map(); // url -> { rows: projected [{x,y,pet,ntzg}], anchor: raw first row }

	async function loadRows(url) {
		if (rowsCache.has(url)) return rowsCache.get(url);
		let raw = [];
		try {
			const res = await fetch(url);
			if (res.ok) raw = parseCsv(await res.text());
		} catch (err) {
			console.warn(`heatmap data: failed to load ${url}`, err);
		}
		const entry = {
			rows: raw.map((r) => {
				const [x, y] = project(r.x, r.y);
				return { ...r, x, y };
			}),
			anchor: raw[0]
		};
		rowsCache.set(url, entry);
		return entry;
	}

	async function refresh(url, center, radius, options) {
		const { rows, anchor } = await loadRows(url);
		const geojson = buildGeoJson(rows, anchor, center, radius, options);
		set(geojson);
		return geojson;
	}

	return { subscribe, refresh };
}
