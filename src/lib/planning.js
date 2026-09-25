// Planning restrictions per site (see `planning` in sites.js): which layers a
// site has, how each is drawn, and loading them into lon/lat for MapLibre.

import proj4 from 'proj4';
import { EPSG25832 } from '$lib/geo.js';
import {
	CUSTOM_COLORS,
	PLANNING_BOUNDARY,
	PLANNING_DESIGN,
	PLANNING_RESTRICTION_COLORS
} from '$lib/style.js';

/**
 * @typedef {{
 *   id: string, url: string, number: number, label: string,
 *   group: 'restriction' | 'design' | 'custom', boundary: boolean,
 *   color: string, fillOpacity: number, lineWidth: number, dashed: boolean
 * }} PlanningLayer
 */

// The files spell umlauts out as ae/oe/ue. Only the words known to carry one
// are turned back: a blanket ae→ä would also hit words really spelled "ae".
/** @type {[RegExp, string][]} */
const UMLAUTS = [
	[/Raeumliche/g, 'Räumliche'],
	[/Gebaeude/g, 'Gebäude'],
	[/flaeche/g, 'fläche']
];

// "03_MA_RaeumlicheAbgrenzung_minusZusatzparameter.geojson" → "− Zusatzparameter".
// Everything but 00 is the boundary minus something, so only that part is shown.
/** @param {string} file */
function labelFor(file) {
	const rest = file.replace(/\.geojson$/i, '').replace(/^\d+_[^_]+_/, '');
	const minus = rest.match(/_minus(.+)$/);
	let label = minus ? minus[1] : rest;
	for (const [pattern, word] of UMLAUTS) label = label.replace(pattern, word);
	label = label.replace(/_/g, ' ').replace(/([a-zäöüß])([A-ZÄÖÜ])/g, '$1 $2');
	return minus ? `− ${label}` : label;
}

// Every layer a site has, in stacking order, with its style resolved so the map
// and the panel's swatches read the same values. Empty for a site with no data.
/** @param {{ planning?: { dir: string, files: string[], labels?: Record<string, string> } | null }} site @returns {PlanningLayer[]} */
export function planningLayers(site) {
	const planning = site.planning;
	if (!planning) return [];
	let slot = 0; // next restriction colour
	return planning.files
		.map((file) => ({ file, number: Number(file.match(/^(\d+)_/)?.[1] ?? NaN) }))
		.sort((a, b) => a.number - b.number)
		.map(({ file, number }) => {
			const boundary = number === 0;
			const group = /Entwurf/i.test(file) ? 'design' : 'restriction';
			const style =
				group === 'design'
					? { color: PLANNING_DESIGN, fillOpacity: 0.3, lineWidth: 2.4, dashed: false }
					: boundary
						? { color: PLANNING_BOUNDARY, fillOpacity: 0, lineWidth: 1.6, dashed: true }
						: {
								color: PLANNING_RESTRICTION_COLORS[slot++ % PLANNING_RESTRICTION_COLORS.length],
								fillOpacity: 0.12,
								lineWidth: 1.5,
								dashed: false
							};
			return {
				id: `${planning.dir}/${file}`,
				url: encodeURI(`/geojson/planning_areas/${planning.dir}/${file}`),
				number,
				label: planning.labels?.[file] ?? labelFor(file),
				group,
				boundary,
				...style
			};
		});
}

// Most files are in EPSG:25832 and say so; at least one has no `crs` and is
// already lon/lat. A missing `crs` is therefore decided by the coordinates.
// Any other declared CRS is refused rather than drawn in the wrong place.
/** @param {any} geojson @param {any[]} features @returns {boolean} */
function isProjected(geojson, features) {
	const name = geojson.crs?.properties?.name;
	if (typeof name === 'string') {
		if (name.includes('25832')) return true;
		if (/4326|CRS84/i.test(name)) return false;
		throw new Error(`Unsupported CRS ${name} — use EPSG:25832 or WGS84`);
	}
	let first = features[0]?.geometry.coordinates;
	while (Array.isArray(first?.[0])) first = first[0];
	return Array.isArray(first) && Math.abs(first[0]) > 180;
}

/** @param {any} coords @returns {any} */
const reproject = (coords) =>
	typeof coords[0] === 'number' ? proj4(EPSG25832, 'WGS84', [coords[0], coords[1]]) : coords.map(reproject);

// Any GeoJSON — a FeatureCollection, a single Feature or a bare geometry — as
// plain features in lon/lat. Geometry collections and empty geometries are
// dropped; properties are not kept, the overlay styles by layer.
/** @param {any} geojson @returns {any[]} */
export function toLonLatFeatures(geojson) {
	const raw =
		geojson?.type === 'FeatureCollection'
			? (geojson.features ?? [])
			: geojson?.type === 'Feature'
				? [geojson]
				: typeof geojson?.type === 'string'
					? [{ type: 'Feature', geometry: geojson }]
					: null;
	if (!raw) throw new Error('Not a GeoJSON object');
	const features = raw.filter((/** @type {any} */ f) => Array.isArray(f?.geometry?.coordinates));
	const projected = isProjected(geojson, features);
	return features.map((/** @type {any} */ f) => ({
		type: 'Feature',
		properties: {},
		geometry: {
			type: f.geometry.type,
			coordinates: projected ? reproject(f.geometry.coordinates) : f.geometry.coordinates
		}
	}));
}

// A dropped GeoJSON file, styled like a planning layer so the same overlay
// draws it. Colours cycle through CUSTOM_COLORS in drop order.
/** @param {string} name @param {any[]} features @param {number} index @returns {PlanningLayer & { features: any[] }} */
export function customLayer(name, features, index) {
	return {
		id: `custom/${index}`,
		url: '',
		number: 100 + index, // above every planning file
		label: name.replace(/\.(geo)?json$/i, ''),
		group: 'custom',
		boundary: false,
		color: CUSTOM_COLORS[index % CUSTOM_COLORS.length],
		fillOpacity: 0.15,
		lineWidth: 2,
		dashed: false,
		features
	};
}

// Fetched once per URL and kept for the page's lifetime.
/** @type {Map<string, Promise<any[] | null>>} */
const cache = new Map();

// The layer's features in lon/lat, or null if the file couldn't be loaded.
/** @param {string} url @returns {Promise<any[] | null>} */
export function loadPlanningLayer(url) {
	let pending = cache.get(url);
	if (!pending) {
		pending = fetch(url)
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json();
			})
			.then(toLonLatFeatures)
			.catch((err) => {
				console.warn(`planning: failed to load ${url}`, err);
				cache.delete(url); // retried on the next toggle
				return null;
			});
		cache.set(url, pending);
	}
	return pending;
}
