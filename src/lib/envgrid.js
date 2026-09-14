// Talks to the simulation backend's calculateEnvGrid endpoint, which reruns a
// site's grid with a set of interventions (the trees from a dropped logfile)
// applied. The browser never calls the backend directly: it speaks plain http
// and sends no CORS headers, so /api/env-grid relays the request server-side.
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
/** @param {EnvGridRequest} request */
export function envGridQuery({ center: [lon, lat], radius, gridType, interventions }) {
	const list = interventions
		.map(
			(t) =>
				`{interventionType=${t.type},gpsCoordinate=${coordinate(t.lat, t.lon)},isNew=${t.isNew}}`
		)
		.join(',');
	return new URLSearchParams({
		centerCoordinate: coordinate(lat, lon),
		radiusInMeters: String(radius),
		gridType,
		interventions: `[${list}]`
	}).toString();
}

// Client side: asks the relay for a recalculated grid. Throws with a message
// meant for the control panel.
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

// Turns the response into the { x, y, pet, ntzg } rows Heatmap parses out of
// its CSVs, with x,y as UTM 32N (EPSG:25832) cell centres — so the result is
// drawn with crs 'epsg25832' and the returned pitch, like the static 1 m set.
//
// The backend computes on the same UTM grid the 1 m CSVs use: it snaps
// centerCoordinate to a cell corner and lays whole cells out along easting and
// northing. Placed that way, a run without interventions reproduces the static
// Dalbergplatz CSV value for value. Laid out along lon/lat instead, the grid
// sits turned by the meridian convergence (~0.4° here) against the static one.
//
// Despite the API docs ("lines (x) west to east, columns (y) north to south"),
// the arrays nest as gridData[row][col]: the outer index runs north→south, the
// inner one west→east. Read the documented way, the grid comes out mirrored
// across the NW–SE diagonal against the static CSVs of the same site.
/** @param {EnvGrid} grid @returns {{ rows: { x: number, y: number, pet: number, ntzg: number }[], pitch: number }} */
export function gridToRows({ centerCoordinate, radiusInMeters, gridData }) {
	const ny = gridData.length; // rows, north→south
	const nx = gridData.reduce((n, row) => Math.max(n, row?.length ?? 0), 0); // columns, west→east
	const pitch = (2 * radiusInMeters) / Math.max(nx, 1); // metres per cell
	if (nx === 0 || ny === 0) return { rows: [], pitch };

	const [easting, northing] = proj4('WGS84', EPSG25832, [
		centerCoordinate.longitude,
		centerCoordinate.latitude
	]);
	const west = easting - (nx / 2) * pitch;
	const north = northing + (ny / 2) * pitch;

	const rows = [];
	for (let y = 0; y < ny; y++) {
		const line = gridData[y] ?? [];
		for (let x = 0; x < nx; x++) {
			const value = line[x];
			rows.push({
				x: west + (x + 0.5) * pitch,
				y: north - (y + 0.5) * pitch,
				// null marks a cell without a value (a building, say); NaN makes
				// Heatmap treat it as filtered, same as an invalid CSV value.
				pet: typeof value === 'number' ? value : NaN,
				ntzg: NaN
			});
		}
	}
	return { rows, pitch };
}
