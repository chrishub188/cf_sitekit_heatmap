// The four ways data is cropped to a site (see CLIP_SHAPES in sites.js), shared
// by every overlay so the heatmap cells and anything drawn over them appear and
// disappear on exactly the same boundary.

import { haversine } from '$lib/geo.js';

// Even-odd ray cast; ring[0] is the outer boundary, any further rings are holes.
/** @param {number} x @param {number} y @param {number[][]} ring */
function pointInRing(x, y, ring) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
		if (crosses) inside = !inside;
	}
	return inside;
}

/** @param {number} x @param {number} y @param {number[][][]} rings */
export function pointInPolygon(x, y, rings) {
	if (!pointInRing(x, y, rings[0])) return false;
	return !rings.slice(1).some((hole) => pointInRing(x, y, hole));
}

// Predicate for one clip shape. Takes lon/lat explicitly rather than a row
// object, so callers with their own point shape can use it directly.
/**
 * @param {string} shape
 * @param {{ bounds?: number[], polygonRings?: number[][][] | null, center?: number[], radius?: number }} options
 * @returns {((lng: number, lat: number) => boolean) | null} null when nothing constrains the data
 */
export function clipTest(shape, { bounds, polygonRings, center, radius }) {
	if (shape === 'plaza' && polygonRings) return (lng, lat) => pointInPolygon(lng, lat, polygonRings);
	if (shape === 'circle' && center && radius != null) {
		const [clng, clat] = center;
		return (lng, lat) => haversine(lng, lat, clng, clat) <= radius;
	}
	if (!bounds) return null;
	const [west, south, east, north] = bounds;
	return (lng, lat) => lng >= west && lng <= east && lat >= south && lat <= north;
}

// Fetched once per URL and kept for the page's lifetime, so the two overlays
// share one request and a remount doesn't refetch.
const polygonCache = new Map();

/** @param {string | undefined} filterUrl @returns {Promise<number[][][] | null>} the rings, or null if unavailable */
export async function loadPolygon(filterUrl) {
	if (!filterUrl) return null;
	if (polygonCache.has(filterUrl)) return polygonCache.get(filterUrl);
	let rings = null;
	try {
		const res = await fetch(filterUrl);
		if (res.ok) {
			const geojson = await res.json();
			const geometry = geojson.features?.[0]?.geometry;
			if (geometry?.type === 'Polygon') rings = geometry.coordinates;
		}
	} catch (err) {
		console.warn(`clip: failed to load filter polygon ${filterUrl}`, err);
	}
	polygonCache.set(filterUrl, rings);
	return rings;
}
