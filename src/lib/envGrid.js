// The EnvGrid API's grid format, turned into the column arrays data.js consumes.
//
// The service answers
//
//   GET {base}/calculateEnvGrid?centerCoordinate=…&radiusInMeters=…&gridType=PET
//   -> { sessionId, centerCoordinate: {latitude, longitude}, radiusInMeters,
//        gridType, gridData: (number|null)[][] }
//
// with `gridData` a dense 2-D array of readings — no coordinates at all. This
// module reconstructs them and emits a struct-of-arrays — parallel lng, lat
// and pet arrays plus one cell basis for the whole grid — which is what
// data.js turns into typed arrays and clips.
//
// Deliberately free of framework imports — the transport lives in
// gridSource.js and the orientation check in scripts/check-grid-orientation.js
// imports this file directly under plain node.

/** @typedef {[number, number]} LngLat */

const M_PER_DEG = 111320; // matches data.js / location.js / viewport.js

const mPerDegLng = (/** @type {number} */ lat) => M_PER_DEG * Math.cos((lat * Math.PI) / 180);

/**
 * Metres between two [lng, lat] pairs — equirectangular, as everywhere else in this app.
 * @param {LngLat} a
 * @param {LngLat} b
 */
export function metresBetween([lngA, latA], [lngB, latB]) {
	const dx = (lngB - lngA) * mPerDegLng(latA);
	const dy = (latB - latA) * M_PER_DEG;
	return Math.hypot(dx, dy);
}

/**
 * Snaps [lng, lat] to a lattice of `step` metres, so nearby positions share one request.
 * @param {LngLat} point
 * @param {number} step
 * @returns {LngLat}
 */
export function snapTo([lng, lat], step) {
	const dLat = step / M_PER_DEG;
	const dLng = step / mPerDegLng(lat);
	return [Math.round(lng / dLng) * dLng, Math.round(lat / dLat) * dLat];
}

// Metres between neighbouring samples — the size of one drawn cell.
//
// The response doesn't report it, and it can't be assumed: the service is free
// to answer a large radius with a coarser grid, and getting it wrong is
// silently wrong output rather than an error (too small leaves gaps between
// cells, too large overlaps them). It follows from the radius and the sample
// count, given which of the two conventions the grid uses:
//
//   odd count  — a sample sits exactly on the centre  -> 2R / (n - 1)
//   even count — samples straddle it                  -> 2R / n
function pitchFor(/** @type {number} */ n, /** @type {number} */ radius) {
	if (!(n > 1)) throw new Error(`EnvGrid: need at least 2 samples per axis, got ${n}`);
	return n % 2 === 1 ? (2 * radius) / (n - 1) : (2 * radius) / n;
}

// Angle between the grid's "north" and true north, in radians.
//
// The service models on UTM, not on a north-aligned lattice: its rows run along
// the projection's easting axis, which is off true east by the grid
// convergence. Treating them as east-west puts every cell at a small angle from
// where it belongs — nothing at the centre, growing with distance, about 0.7 m
// at 100 m here and 1.6 m where convergence is steepest.
//
// Measured, not assumed: scored against the survey CSVs, the live service
// matches a rotated grid (agreement decaying from 98.6% at the centre to 91% at
// 225 m) and not a north-aligned one (flat ~98%). See
// scripts/check-grid-orientation.js.
//
// The zone comes from the response's own centre, so this needs no configuration
// and follows the service if it ever answers outside zone 32.
function convergence(/** @type {number} */ lng, /** @type {number} */ lat) {
	const zone = Math.floor((lng + 180) / 6) + 1;
	const centralMeridian = zone * 6 - 183;
	const dLng = ((lng - centralMeridian) * Math.PI) / 180;
	return Math.atan(Math.tan(dLng) * Math.sin((lat * Math.PI) / 180));
}

// Which index of gridData is which axis, and which way latitude runs.
//
// The API documents "lines (x) in grid are from west to east, columns (y) are
// from north to south", which reads as gridData[x][y]. It is not: the service
// returns gridData[y][x], so the default below is `yx`. Measured, not guessed
// — scripts/check-grid-orientation.js scores all four candidates against the
// survey CSVs and the live service, and all three sites agree (94-98% null-mask
// agreement for yx/top against 51-69% for the documented reading).
//
// This is worth settling numerically rather than by eye, because a square grid
// makes a transpose *undetectable at runtime* and PET is smooth enough in space
// that the wrong orientation still renders as a plausible heat pattern — just
// in the wrong place. ?gridorder= and ?gridnorth= override it without a
// redeploy if the service ever changes.
/**
 * @param {{centerCoordinate: {latitude: number, longitude: number}, radiusInMeters: number, gridData: (number|null)[][], sessionId?: string, gridType?: string}} response
 * @param {{order?: 'xy'|'yx', north?: 'top'|'bottom'}} [orientation]
 */
export function gridToColumns(response, { order = 'xy', north = 'top' } = {}) {
	const grid = response?.gridData;
	const radius = Number(response?.radiusInMeters);
	const lat0 = Number(response?.centerCoordinate?.latitude);
	const lng0 = Number(response?.centerCoordinate?.longitude);

	if (!Array.isArray(grid) || !Array.isArray(grid[0])) throw new Error('EnvGrid: gridData is not a 2-D array');
	if (!Number.isFinite(radius) || radius <= 0) throw new Error(`EnvGrid: bad radiusInMeters ${response?.radiusInMeters}`);
	if (!Number.isFinite(lat0) || !Number.isFinite(lng0)) throw new Error('EnvGrid: bad centerCoordinate');

	// `order` says which way round gridData is indexed; cols count x (west to
	// east), rows count y (north to south).
	const cols = order === 'xy' ? grid.length : grid[0].length;
	const rows = order === 'xy' ? grid[0].length : grid.length;
	const at =
		order === 'xy'
			? (/** @type {number} */ x, /** @type {number} */ y) => grid[x]?.[y]
			: (/** @type {number} */ x, /** @type {number} */ y) => grid[y]?.[x];

	const pitchX = pitchFor(cols, radius);
	const pitchY = pitchFor(rows, radius);
	const degPerMX = 1 / mPerDegLng(lat0);
	const degPerMY = 1 / M_PER_DEG;

	// Grid axes -> true east/north. Rotating by -convergence takes a step along
	// the projection's easting onto the ground.
	const rot = -convergence(lng0, lat0);
	const cos = Math.cos(rot);
	const sin = Math.sin(rot);

	const n = cols * rows;
	/** @type {number[]} */ const lng = new Array(n);
	/** @type {number[]} */ const lat = new Array(n);
	/** @type {(number | null)[]} */ const pet = new Array(n);

	// Row-major, x fastest.
	for (let y = 0; y < rows; y++) {
		// Rank from the northern edge: the array index itself when row 0 is north.
		const rank = north === 'top' ? y : rows - 1 - y;
		// Metres from the centre along the grid's own axes.
		const gridNorth = -(rank - (rows - 1) / 2) * pitchY;
		for (let x = 0; x < cols; x++) {
			const gridEast = (x - (cols - 1) / 2) * pitchX;
			const i = y * cols + x;
			lng[i] = lng0 + (gridEast * cos - gridNorth * sin) * degPerMX;
			lat[i] = lat0 + (gridEast * sin + gridNorth * cos) * degPerMY;
			const value = at(x, y);
			// null (or a ragged row) means no reading — data.js draws those as
			// ghost cells.
			pet[i] = typeof value === 'number' && Number.isFinite(value) ? value : null;
		}
	}

	return {
		// Half-basis vectors of one cell, in degrees: half a pitch along each of
		// the grid's own axes, which data.js turns into the cell's outline. They
		// carry the same rotation as the cell centres above, so cells stay square
		// to the grid rather than to the compass.
		cell: {
			ax: ((pitchX / 2) * cos) * degPerMX,
			ay: ((pitchX / 2) * sin) * degPerMY,
			bx: ((pitchY / 2) * -sin) * degPerMX,
			by: ((pitchY / 2) * cos) * degPerMY
		},
		lng,
		lat,
		pet,
		// Carried, not used yet: each call "creates a new session", which is
		// almost certainly the handle an intervention API ("plant a tree here,
		// re-model") will want to refer back to.
		sessionId: response.sessionId ?? null,
		center: /** @type {LngLat} */ ([lng0, lat0]),
		radius,
		pitch: [pitchX, pitchY]
	};
}
