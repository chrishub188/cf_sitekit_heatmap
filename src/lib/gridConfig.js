// Grid-source configuration, read from the page's query params.
//
// Same shape and the same reasoning as embedPose.js: the page is embedded in
// an <iframe> by a host app that owns the URL, so the URL is the whole
// configuration surface. Everything here is read once at module load and
// exported as a plain constant — no reactivity, no re-reading. A host that
// wants a different setting navigates the iframe, which reloads the page.
//
//   grid=api|off          whether the overlay is drawn at all      (api)
//   gridtype=<GridType>   which layer the API should calculate    (PET)
//   gridradius=<metres>   radius requested from the API           (100)
//   gridepoch=<n>         bump to bypass every cache              (0)
//   gridorder=xy|yx       outer index of gridData: x or y         (yx)
//   gridnorth=top|bottom  whether row 0 is the northern edge      (top)
//
// The last two are an escape hatch, not a setting anyone should need: see
// envGrid.js for why the grid's orientation can't be detected at runtime and
// has to be pinned down once against known data.

const params =
	typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

/** The gridType values the API documents. Anything else is a typo, not a layer. */
export const GRID_TYPES = [
	'PET',
	'TEMPERATURE_CELSIUS',
	'SEALED_GROUND_CATEGORY',
	'NOISE',
	'CO2',
	'FEELGOOD_FACTOR',
	'HUMIDITY'
];

const oneOf = (/** @type {string} */ name, /** @type {string[]} */ allowed, /** @type {string} */ fallback) => {
	const value = params.get(name);
	if (value === null) return fallback;
	if (allowed.includes(value)) return value;
	console.warn(`gridConfig: ignoring ?${name}=${value} — expected one of ${allowed.join(', ')}`);
	return fallback;
};

const integer = (/** @type {string} */ name, /** @type {number} */ fallback, /** @type {number} */ min, /** @type {number} */ max) => {
	// Note the explicit null check: Number(null) is 0, not NaN, so an absent
	// param would otherwise read as a deliberate zero and clamp to `min`.
	const raw = params.get(name);
	if (raw === null) return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value)) {
		console.warn(`gridConfig: ignoring ?${name}=${raw} — not a number`);
		return fallback;
	}
	const clamped = Math.min(max, Math.max(min, Math.round(value)));
	if (clamped !== Math.round(value)) {
		console.warn(`gridConfig: clamped ?${name}=${raw} to ${clamped} (allowed ${min}–${max})`);
	}
	return clamped;
};

/** 'api' — live EnvGrid service; 'off' — basemap and marker only. */
export const GRID_MODE = /** @type {'api' | 'off'} */ (oneOf('grid', ['api', 'off'], 'api'));

/** Passed straight through to the API. Note that only PET has a tuned colour ramp. */
export const GRID_TYPE = oneOf('gridtype', GRID_TYPES, 'PET');

// Radius requested from the API, in metres. Bigger means fewer requests as the
// visitor walks but a heavier response and a slower clip scan; see the payload
// table in README. The lower bound is RADIUS (the clip) plus room to move —
// below that every other step would trigger a refetch.
export const FETCH_RADIUS_M = integer('gridradius', 100, 60, 300);

/** Bumped to bypass both the in-memory cache and any HTTP cache in front of the API. */
export const INITIAL_EPOCH = integer('gridepoch', 0, 0, Number.MAX_SAFE_INTEGER);

/** 'xy' — gridData[x][y]; 'yx' — gridData[y][x], which is what the service does. See envGrid.js. */
export const GRID_ORDER = /** @type {'xy' | 'yx'} */ (oneOf('gridorder', ['xy', 'yx'], 'yx'));

/** 'top' — the first column of a line is the northern edge; 'bottom' — the southern. */
export const GRID_NORTH = /** @type {'top' | 'bottom'} */ (oneOf('gridnorth', ['top', 'bottom'], 'top'));
