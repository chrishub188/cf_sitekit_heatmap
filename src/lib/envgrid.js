// Talks to the simulation backend's calculateEnvGrid endpoint, the source of
// every heatmap: called without interventions it returns a site's baseline
// grid, called with the trees from a dropped logfile it reruns the grid with
// them applied. The browser never calls the backend directly: it speaks plain
// http and sends no CORS headers, so /api/env-grid relays the request server-side.
//
// The endpoint's query values use the same pseudo-JSON as the logfiles —
// unquoted keys, `=` inside objects, bare enums:
//
//   centerCoordinate={latitude:49.46,longitude:8.48}&radiusInMeters=150&gridType=PET
//   &interventions=[{interventionType=TREE_SMALL,gpsCoordinate={latitude:…,longitude:…},isNew=true}]

import proj4 from 'proj4';
import { EPSG25832 } from '$lib/geo.js';

export const GRID_TYPES = [
	'PET',
	'TEMPERATURE_CELSIUS',
	'SEALED_GROUND_CATEGORY',
	'NOISE',
	'CO2',
	'FEELGOOD_FACTOR',
	'HUMIDITY'
];

/**
 * @typedef {{ type: string, lat: number, lon: number, isNew: boolean }} GridIntervention
 * @typedef {{ center: [number, number], radius: number, gridType: string,
 *             interventions: GridIntervention[] }} EnvGridRequest
 * @typedef {{ sessionId?: string, centerCoordinate: { latitude: number, longitude: number },
 *             radiusInMeters: number, gridType: string, gridData: (number | null)[][] }} EnvGrid
 */

/** @param {number} lat @param {number} lon */
const coordinate = (lat, lon) => `{latitude:${lat},longitude:${lon}}`;

// Query string for the backend. URLSearchParams percent-encodes the braces and
// brackets, which a servlet container would otherwise reject as raw characters.
// A baseline request leaves `interventions` out entirely, which is how the
// endpoint is documented to be called.
/** @param {EnvGridRequest} request */
export function envGridQuery({ center: [lon, lat], radius, gridType, interventions }) {
	const params = new URLSearchParams({
		centerCoordinate: coordinate(lat, lon),
		radiusInMeters: String(radius),
		gridType
	});
	if (interventions.length) {
		const list = interventions
			.map(
				(t) =>
					`{interventionType=${t.type},gpsCoordinate=${coordinate(t.lat, t.lon)},isNew=${t.isNew}}`
			)
			.join(',');
		params.set('interventions', `[${list}]`);
	}
	return params.toString();
}

// Client side: asks the relay for a grid. Throws with a message meant for the
// control panel.
/** @param {EnvGridRequest} request @param {AbortSignal} [signal] @returns {Promise<EnvGrid>} */
export async function requestEnvGrid(request, signal) {
	const res = await fetch('/api/env-grid', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(request),
		signal
	});
	if (!res.ok) {
		const message = await res
			.json()
			.then((body) => body?.message)
			.catch(() => null);
		throw new Error(message ?? `Simulation failed (${res.status})`);
	}
	const grid = await res.json();
	if (!Array.isArray(grid?.gridData) || !grid.centerCoordinate || !(grid.radiusInMeters > 0)) {
		throw new Error('Simulation returned no grid');
	}
	return grid;
}

// Turns the response into the { x, y, pet } rows Heatmap draws, with x,y as
// UTM 32N (EPSG:25832) cell centres and `pitch` the cell size in metres.
//
// The backend computes on a UTM grid: it snaps centerCoordinate to a cell
// corner and lays whole cells out along easting and northing (1 m cells, so a
// 150 m radius comes back as 300 × 300). Laid out along lon/lat instead, the
// grid would sit turned by the meridian convergence (~0.4° here).
//
// Despite the API docs ("lines (x) west to east, columns (y) north to south"),
// the arrays nest as gridData[row][col]: the outer index runs north→south, the
// inner one west→east. Read the documented way, the grid comes out mirrored
// across the NW–SE diagonal against the site it was requested for.
//
// cellSize asks for coarser cells than the backend's: each output cell
// averages the block of native cells it covers, ignoring the null ones, and is
// only null itself when the whole block is.
/**
 * @param {EnvGrid} grid
 * @param {number} [cellSize] metres; rounded to a whole multiple of the native pitch
 * @returns {{ rows: { x: number, y: number, pet: number }[], pitch: number }}
 */
export function gridToRows({ centerCoordinate, radiusInMeters, gridData }, cellSize = 0) {
	const ny = gridData.length; // rows, north→south
	const nx = gridData.reduce((n, row) => Math.max(n, row?.length ?? 0), 0); // columns, west→east
	const native = (2 * radiusInMeters) / Math.max(nx, 1); // metres per backend cell
	if (nx === 0 || ny === 0) return { rows: [], pitch: native };
	const k = Math.max(1, Math.round(cellSize / native)); // backend cells per output cell, per axis
	const pitch = native * k;

	const [easting, northing] = proj4('WGS84', EPSG25832, [
		centerCoordinate.longitude,
		centerCoordinate.latitude
	]);
	const west = easting - (nx / 2) * native;
	const north = northing + (ny / 2) * native;

	const rows = [];
	for (let by = 0; by * k < ny; by++) {
		for (let bx = 0; bx * k < nx; bx++) {
			let sum = 0;
			let count = 0;
			for (let y = by * k; y < Math.min(ny, (by + 1) * k); y++) {
				const line = gridData[y] ?? [];
				for (let x = bx * k; x < Math.min(nx, (bx + 1) * k); x++) {
					const value = line[x];
					if (typeof value === 'number' && Number.isFinite(value)) {
						sum += value;
						count++;
					}
				}
			}
			rows.push({
				x: west + (bx + 0.5) * pitch,
				y: north - (by + 0.5) * pitch,
				// null marks a cell without a value (a building, say); NaN makes
				// Heatmap treat it as filtered.
				pet: count ? sum / count : NaN
			});
		}
	}
	return { rows, pitch };
}
