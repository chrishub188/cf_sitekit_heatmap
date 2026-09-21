// Same-origin proxy for the EnvGrid service.
//
// Three problems, one route:
//
//  - Mixed content. The service is plain http; this app is served over https.
//    A browser blocks that outright, with no override and no console warning
//    worth the name — and the Quest's browser is no different.
//  - CORS. The service's headers are unknown and not ours to change.
//  - Caching. The client asks about snapped, canonical coordinates (see
//    gridSource.js), so identical requests from different headsets — or the
//    same one on a later visit — collapse onto one cached response here
//    instead of re-running the model.
//
// Plain SvelteKit, nothing host-specific: it works under `vite dev` and under
// any adapter. The upstream base URL comes from the environment and never
// from the request — a proxy that forwards to a client-supplied host is an
// open SSRF relay.
//
// An optional `interventions` param (JSON, see $lib/intervention.js) rides
// along with the usual centerCoordinate/radiusInMeters/gridType request when
// present — same upstream endpoint, one more query param. This is the actual
// trust boundary the parsed JSON crosses, so every element is rebuilt from
// only its known, checked fields (parseInterventions below) rather than
// forwarded verbatim.
//
// An optional `sessionId` param is different: it's mutually exclusive with
// `centerCoordinate`/`radiusInMeters`, not an addition to them. The service
// dispatches `calculateEnvGrid` by matching the exact set of parameter names
// to one of three overloaded methods — confirmed against the live service,
// not just the docs — and `centerCoordinate` alongside `sessionId` matches
// none of them ("No method found with name 'calculateEnvGrid' and
// parameters [...]"), rather than the extra param simply being ignored. So
// `sessionId` present means a *different*, coordinate-free request:
// `sessionId` (+ `gridType`, + optional `interventions`) and nothing else —
// see callUpstreamBySession below.

import { env } from '$env/dynamic/private';
import { parseIntervention, MAX_INTERVENTIONS } from '$lib/intervention.js';

const GRID_TYPES = new Set([
	'PET',
	'TEMPERATURE_CELSIUS',
	'SEALED_GROUND_CATEGORY',
	'NOISE',
	'CO2',
	'FEELGOOD_FACTOR',
	'HUMIDITY'
]);

const MIN_RADIUS_M = 10;
const MAX_RADIUS_M = 500;
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_SESSION_ID_LEN = 256;

// The API docs give `centerCoordinate=GpsCoordinate` without saying how a
// GpsCoordinate is spelled in a query string. Rather than hard-code a guess and
// need a redeploy to correct it, try the plausible spellings in order and
// remember which one worked for the life of the server instance.
/** @type {Record<string, (lat: number, lng: number) => Record<string, string>>} */
const ENCODINGS = {
	'lat,lng': (lat, lng) => ({ centerCoordinate: `${lat},${lng}` }),
	'lng,lat': (lat, lng) => ({ centerCoordinate: `${lng},${lat}` }),
	json: (lat, lng) => ({ centerCoordinate: JSON.stringify({ latitude: lat, longitude: lng }) }),
	pair: (lat, lng) => ({ latitude: String(lat), longitude: String(lng) })
};

/** @type {string | null} */
let preferred = null;

/**
 * @param {string} base
 * @param {string} encoding
 * @param {number} lat
 * @param {number} lng
 * @param {number} radius
 * @param {string} type
 */
function upstreamUrl(base, encoding, lat, lng, radius, type) {
	const url = new URL('calculateEnvGrid', base.endsWith('/') ? base : `${base}/`);
	for (const [key, value] of Object.entries(ENCODINGS[encoding](lat, lng))) {
		url.searchParams.set(key, value);
	}
	url.searchParams.set('radiusInMeters', String(radius));
	url.searchParams.set('gridType', type);
	return url;
}

/** First line of an upstream body, trimmed — enough to see what it objected to. */
const summarise = (/** @type {string} */ text) => {
	const line = text.replace(/\s+/g, ' ').trim();
	return line.length > 200 ? `${line.slice(0, 200)}…` : line || '(empty body)';
};

const isGrid = (/** @type {any} */ body) => Array.isArray(body?.gridData) && Array.isArray(body.gridData[0]);

/**
 * Parses and validates the `interventions` query param. Never trusts the
 * parsed JSON as-is — this is the actual trust boundary an HTTP request
 * crosses, so every element is rebuilt from only its known, checked fields
 * rather than forwarded verbatim.
 * @param {string} raw
 * @returns {import('$lib/intervention.js').Intervention[]}
 */
function parseInterventions(raw) {
	/** @type {unknown} */
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('not valid JSON');
	}
	if (!Array.isArray(parsed)) throw new Error('expected an array');
	if (parsed.length > MAX_INTERVENTIONS) throw new Error(`at most ${MAX_INTERVENTIONS} interventions`);

	return parsed.map((item, i) => {
		const clean = parseIntervention(item);
		if (!clean) throw new Error(`invalid intervention at index ${i}`);
		return clean;
	});
}

/**
 * @param {string} base
 * @param {string | null} encoding
 * @param {number} lat
 * @param {number} lng
 * @param {number} radius
 * @param {string} type
 * @param {import('$lib/intervention.js').Intervention[]} interventions
 * @param {AbortSignal} signal
 */
async function callUpstream(base, encoding, lat, lng, radius, type, interventions, signal) {
	// Whatever was asked for or worked last time first, then the rest as fallbacks.
	const first = encoding ?? preferred;
	const order = [...new Set(first ? [first, ...Object.keys(ENCODINGS)] : Object.keys(ENCODINGS))];

	/** @type {string[]} */
	const tried = [];
	for (const name of order) {
		const url = upstreamUrl(base, name, lat, lng, radius, type);
		if (interventions.length) url.searchParams.set('interventions', JSON.stringify(interventions));
		const res = await fetch(url, { headers: { accept: 'application/json' }, signal });

		// Read as text first. The service answers at least some bad requests with
		// 200 and a plain-text message, so parsing straight to JSON turns "this
		// spelling was wrong" into a SyntaxError that escapes the loop and stops
		// the remaining spellings from ever being tried.
		const text = await res.text();
		let body = null;
		try {
			body = JSON.parse(text);
		} catch {
			body = null;
		}

		if (res.ok && isGrid(body)) {
			preferred = name;
			return body;
		}

		tried.push(`${name} -> HTTP ${res.status} ${summarise(text)}`);
		// A 5xx is the service having a bad day, not us spelling the coordinate
		// wrong — trying the other spellings would just pile on.
		if (res.status >= 500) break;
		// An explicit encoding was asked for; don't silently use another.
		if (encoding) break;
	}
	throw new Error(`no coordinate encoding was accepted:\n  ${tried.join('\n  ')}`);
}

/**
 * Session-mode call: `sessionId` (+ `gridType`, + optional `interventions`)
 * and nothing else. No `ENCODINGS` trial loop here — there's no coordinate
 * to spell, since sending one alongside `sessionId` fails dispatch upstream
 * (see the header comment above).
 * @param {string} base
 * @param {string} sessionId
 * @param {string} type
 * @param {import('$lib/intervention.js').Intervention[]} interventions
 * @param {AbortSignal} signal
 */
async function callUpstreamBySession(base, sessionId, type, interventions, signal) {
	const url = new URL('calculateEnvGrid', base.endsWith('/') ? base : `${base}/`);
	url.searchParams.set('sessionId', sessionId);
	url.searchParams.set('gridType', type);
	if (interventions.length) url.searchParams.set('interventions', JSON.stringify(interventions));

	const res = await fetch(url, { headers: { accept: 'application/json' }, signal });
	const text = await res.text();
	let body = null;
	try {
		body = JSON.parse(text);
	} catch {
		body = null;
	}
	if (res.ok && isGrid(body)) return body;
	throw new Error(`HTTP ${res.status} ${summarise(text)}`);
}

const fail = (/** @type {number} */ status, /** @type {string} */ message) =>
	new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
	});

const respond = (/** @type {unknown} */ body) =>
	new Response(JSON.stringify(body), {
		headers: {
			'content-type': 'application/json',
			// The grid models a fixed moment, so a hit stays correct for a long
			// time. `e` on the request URL is what busts this when the host says
			// the world changed.
			'cache-control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800'
		}
	});

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
	const base = env.ENV_GRID_BASE;
	if (!base) {
		console.error('api/grid: ENV_GRID_BASE is not set — see .env.example');
		return fail(503, 'grid service is not configured');
	}

	const type = url.searchParams.get('type') ?? 'PET';
	if (!GRID_TYPES.has(type)) return fail(400, 'unknown gridType');

	const sessionIdRaw = url.searchParams.get('sessionId');
	if (sessionIdRaw !== null && (sessionIdRaw.length === 0 || sessionIdRaw.length > MAX_SESSION_ID_LEN)) {
		return fail(400, `sessionId must be 1–${MAX_SESSION_ID_LEN} characters`);
	}
	const sessionId = sessionIdRaw || null;

	const interventionsRaw = url.searchParams.get('interventions');
	/** @type {import('$lib/intervention.js').Intervention[]} */
	let interventions = [];
	if (interventionsRaw) {
		try {
			interventions = parseInterventions(interventionsRaw);
		} catch (err) {
			return fail(400, `invalid interventions: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// Session mode: no coordinate anywhere in this branch — see the header
	// comment and callUpstreamBySession for why one can't ride along.
	if (sessionId) {
		try {
			const body = await callUpstreamBySession(
				base,
				sessionId,
				type,
				interventions,
				AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
			);
			return respond(body);
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			console.error(`api/grid: upstream failed — ${detail}`);
			return fail(502, `grid service unavailable: ${detail}`);
		}
	}

	const lat = Number(url.searchParams.get('lat'));
	const lng = Number(url.searchParams.get('lng'));
	const radius = Number(url.searchParams.get('r'));
	const encoding = url.searchParams.get('enc'); // manual override, for probing by hand

	if (!Number.isFinite(lat) || lat < -90 || lat > 90) return fail(400, 'lat out of range');
	if (!Number.isFinite(lng) || lng < -180 || lng > 180) return fail(400, 'lng out of range');
	if (!Number.isFinite(radius) || radius < MIN_RADIUS_M || radius > MAX_RADIUS_M) {
		return fail(400, `r must be ${MIN_RADIUS_M}–${MAX_RADIUS_M} metres`);
	}
	if (encoding && !(encoding in ENCODINGS)) return fail(400, 'unknown enc');

	try {
		const body = await callUpstream(
			base,
			encoding,
			lat,
			lng,
			Math.round(radius),
			type,
			interventions,
			AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
		);
		return respond(body);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		console.error(`api/grid: upstream failed — ${detail}`);
		// Echoed to the caller on purpose: in a headset the browser console is
		// the only place anyone can see why the grid never arrived.
		return fail(502, `grid service unavailable: ${detail}`);
	}
}
