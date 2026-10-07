// Small spherical/equirectangular helpers shared by the site geometry and the
// map overlays. Everything here works in lon/lat degrees and metres.

export const M_PER_DEG = 111320; // metres per degree of latitude
export const EARTH_RADIUS = 6371000; // metres
// ETRS89 / UTM zone 32N — covers every site (Mannheim, Kaiserslautern). The
// 1 m CSVs and the simulation backend's grids are both laid out in it.
export const EPSG25832 = '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

// Great-circle distance between two lon/lat points, in metres.
/** @param {number} lng1 @param {number} lat1 @param {number} lng2 @param {number} lat2 */
export function haversine(lng1, lat1, lng2, lat2) {
	const toRad = (/** @type {number} */ d) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
}

// Closed ring approximating a circle of radiusM metres around [lng, lat].
// Same equirectangular convention the site boxes use (dy from M_PER_DEG, dx
// corrected by cos(lat)), so overlays line up with them; at these radii the
// approximation is far below a pixel.
/** @param {number} lng @param {number} lat @param {number} radiusM @param {number} [segments] */
export function circleRing(lng, lat, radiusM, segments = 24) {
	const dLat = radiusM / M_PER_DEG;
	const dLng = dLat / Math.cos((lat * Math.PI) / 180);
	const ring = Array.from({ length: segments }, (_, i) => {
		const theta = (i / segments) * Math.PI * 2;
		return [lng + Math.cos(theta) * dLng, lat + Math.sin(theta) * dLat];
	});
	ring.push(ring[0]);
	return ring;
}

// Closed ring of `shape` (unit-radius [x, y] points, +y north — see
// CROWN_SHAPE) scaled to radiusM metres around [lng, lat] and turned
// clockwise by rotationDeg. Same equirectangular convention as circleRing.
// `step` > 1 keeps every step-th point, for when thousands are drawn at once.
/**
 * @param {number} lng @param {number} lat @param {number} radiusM
 * @param {[number, number][]} shape @param {number} [rotationDeg] @param {number} [step]
 */
export function shapeRing(lng, lat, radiusM, shape, rotationDeg = 0, step = 1) {
	const dLat = radiusM / M_PER_DEG;
	const dLng = dLat / Math.cos((lat * Math.PI) / 180);
	const theta = (-rotationDeg * Math.PI) / 180; // compass degrees turn clockwise
	const [cos, sin] = [Math.cos(theta), Math.sin(theta)];
	const ring = [];
	for (let i = 0; i < shape.length; i += step) {
		const [x, y] = shape[i];
		ring.push([lng + (x * cos - y * sin) * dLng, lat + (x * sin + y * cos) * dLat]);
	}
	ring.push(ring[0]);
	return ring;
}
