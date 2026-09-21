// Where a heatmap's readings come from, and — more to the point — how rarely
// we ask.
//
// A `source` is `{ key, center, radius, load }`: an identity data.js can cache
// on, the area the loaded grid covers, and a function returning the raw column
// arrays. data.js and Heatmap.svelte only ever see this shape, so where the
// readings come from stays this module's business alone.
//
// The whole point of this module is request rate. The host posts a pose at
// ~5 Hz; the API must see nothing like that:
//
//  - The request centre is an *anchor*, not the visitor. It only moves once
//    the visitor has walked REFETCH_AT_M from it, so a request buys tens of
//    metres of walking rather than one frame.
//  - The new anchor is then snapped to a SNAP_M lattice, which makes the URL
//    canonical: two headsets standing in the same place, or the same visitor
//    coming back tomorrow, produce a byte-identical request that an HTTP cache
//    in front of the API can serve without touching the service at all.
//  - A superseded request is aborted, and failures back off exponentially, so
//    a dead API costs one request a minute, not one per step.
//
// There is no fallback data. If the service has nothing for where the visitor
// is standing, the overlay is simply absent and the marker is shown on its
// own — better than a grid that is quietly from somewhere, or some time, else.
//
// The data itself is a model of one moment (14:00), not a live feed, so
// nothing here polls. A change to the *world itself* the API is aware of but
// this app can't express as a request param is announced by the host via
// `refreshGrid` in embedPose.js, which bumps `gridEpoch` and invalidates
// every cache below. An EnvGrid intervention — planting a tree — doesn't need
// that: it's carried as an `interventions` list (embedPose.js's
// `embedInterventions`) and rides along with the anchor-paced request below,
// so a changed list is itself a new request key. It doesn't get its own
// pacing mechanism — an intervention changes at human-action speed, not GPS
// speed, so the existing anchor/backoff machinery already covers it.
//
// `sessionId` (embedPose.js's `embedSessionId`) is different: the upstream
// service dispatches `calculateEnvGrid` by matching the exact set of
// parameter names to one of three overloaded methods, and `centerCoordinate`
// alongside `sessionId` matches none of them — confirmed against the live
// service, not just the docs, it fails dispatch outright rather than being
// ignored. So a session-mode request carries no coordinate at all, which
// means no anchor to pace movement against either: a session's grid doesn't
// move regardless of where the visitor walks, so there is nothing here for
// `anchorFor`/`SNAP_M`/`REFETCH_AT_M` to do while one is active. Only a
// changed `sessionId` or `interventions` value triggers a new fetch.

import { writable } from 'svelte/store';
import { gridToColumns, metresBetween, snapTo } from './envGrid.js';
import { FETCH_RADIUS_M, GRID_ORDER, GRID_NORTH, GRID_TYPE, INITIAL_EPOCH } from './gridConfig.js';
import { RADIUS } from './viewport.js';

/** @typedef {[number, number]} LngLat */

// Same-origin proxy: the service is plain http and its CORS headers are
// unknown, either of which a browser refuses outright. See
// src/routes/api/grid/+server.js.
const ENDPOINT = '/api/grid';

// Lattice the request centre is snapped to. Small enough that the anchor stays
// near the visitor, large enough that ordinary wandering keeps hitting the
// same URL.
const SNAP_M = 25;

// How far the visitor may stray from the anchor before a new grid is fetched.
// Everything within RADIUS of them has to stay inside the fetched disc, so this
// is the slack between the two radii, less a margin for the snap.
const REFETCH_AT_M = Math.max(5, FETCH_RADIUS_M - RADIUS - SNAP_M / 2 - 5);

const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** Bumped when the host tells us the world changed; part of every cache key. */
export const gridEpoch = writable(INITIAL_EPOCH);

// Bumped when a backoff window closes, to drive the retry. It has to reach the
// source key — a retry is only a retry if it looks like a different request to
// the layers above, which otherwise see the failed key they already built and
// do nothing. It stays out of the request URL, though: the URL is what an HTTP
// cache matches on, and a retry has no reason to bust it.
export const gridAttempt = writable(0);

export function bumpGridEpoch() {
	gridEpoch.update((n) => n + 1);
}

// --- request pacing -------------------------------------------------------

/** @type {[number, number] | null} */
let anchor = null;

// The centre we ask about: the current anchor while the visitor is near it,
// otherwise a fresh one snapped to the lattice.
function anchorFor(/** @type {[number, number]} */ center) {
	if (anchor && metresBetween(anchor, center) <= REFETCH_AT_M) return anchor;
	anchor = /** @type {[number, number]} */ (snapTo(center, SNAP_M));
	return anchor;
}

// --- failure handling -----------------------------------------------------

let failures = 0;
let nextAttemptAt = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let retryTimer = null;

function noteSuccess() {
	failures = 0;
	nextAttemptAt = 0;
	if (retryTimer) clearTimeout(retryTimer);
	retryTimer = null;
}

function noteFailure(/** @type {unknown} */ err) {
	failures++;
	// Jittered so several headsets that lost the API together don't retry in
	// lockstep and arrive as a thundering herd when it comes back.
	const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1)) * (0.8 + Math.random() * 0.4);
	nextAttemptAt = Date.now() + wait;
	console.warn(`grid: request failed (${failures}), retrying in ${Math.round(wait / 1000)}s`, err);

	// Scheduled rather than polled, and it has to be scheduled: a visitor
	// standing still generates no new requests, so without this the first
	// failure would be the last attempt ever made. The small margin past
	// `nextAttemptAt` matters — land on it exactly and loadGrid would refuse
	// its own retry as still backing off, and nothing would reschedule.
	if (retryTimer) clearTimeout(retryTimer);
	retryTimer = setTimeout(() => {
		retryTimer = null;
		gridAttempt.update((n) => n + 1);
	}, wait + 250);
}

// --- fetching -------------------------------------------------------------

/** @type {{key: string, controller: AbortController} | null} */
let inflight = null;

/**
 * The upstream service dispatches `calculateEnvGrid` by matching the exact
 * set of parameter names to one of three overloaded methods — confirmed
 * against the live service, not just the docs: sending `centerCoordinate`
 * alongside `sessionId` doesn't get ignored, it fails dispatch outright
 * ("No method found with name 'calculateEnvGrid' and parameters [...]").
 * So a session-mode request sends `sessionId` (+ optional `interventions`)
 * and nothing else — no coordinate, no radius, and consequently no anchor to
 * pace against (see apiSource below).
 * @param {string} key
 * @param {LngLat | null} anchorPoint
 * @param {number} epoch
 * @param {import('./intervention.js').Intervention[]} interventions
 * @param {string | null} sessionId
 */
async function loadGrid(key, anchorPoint, epoch, interventions, sessionId) {
	// Still backing off: answer "no data" without touching the network. The
	// caller keeps whatever it is already showing.
	if (Date.now() < nextAttemptAt) return null;

	// Only one request is ever useful — the visitor can only be in one place.
	if (inflight && inflight.key !== key) inflight.controller.abort();
	const controller = new AbortController();
	inflight = { key, controller };
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	const query = new URLSearchParams({ type: GRID_TYPE });
	if (epoch) query.set('e', String(epoch));
	if (interventions.length) query.set('interventions', JSON.stringify(interventions));
	if (sessionId) {
		query.set('sessionId', sessionId);
	} else {
		const [lng, lat] = /** @type {LngLat} */ (anchorPoint);
		query.set('lat', lat.toFixed(6));
		query.set('lng', lng.toFixed(6));
		query.set('r', String(FETCH_RADIUS_M));
	}

	try {
		const res = await fetch(`${ENDPOINT}?${query}`, { headers: { accept: 'application/json' }, signal: controller.signal });
		if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
		const columns = gridToColumns(await res.json(), { order: GRID_ORDER, north: GRID_NORTH });
		noteSuccess();
		return columns;
	} catch (err) {
		// An abort is us superseding ourselves, not the API misbehaving — it
		// must not count towards the backoff or schedule a retry.
		if (controller.signal.aborted && inflight?.key !== key) return null;
		noteFailure(err);
		return null;
	} finally {
		clearTimeout(timeout);
		if (inflight?.key === key) inflight = null;
	}
}

// --- sources --------------------------------------------------------------

/**
 * Live grid around `center`, pinned to the current anchor — or, when
 * `sessionId` is given, a session-mode grid with no anchor at all (see
 * loadGrid's comment for why: the upstream call can't carry a coordinate
 * alongside a session id, so there's nothing to pace movement against —
 * a session's grid doesn't move regardless of where the visitor walks).
 * @param {[number, number]} center
 * @param {number} epoch
 * @param {number} attempt
 * @param {import('./intervention.js').Intervention[]} [interventions]
 * @param {string | null} [sessionId]
 */
export function apiSource(center, epoch, attempt, interventions = [], sessionId = null) {
	// Fixed decimals and a fixed parameter order, because the coordinates here
	// are also the request URL and an HTTP cache matches on the bytes. An
	// interventions change is itself a reason to refetch, so it's just another
	// segment of the key — present only when there's something to apply, same
	// as every other optional part of this request.
	const ivPart = interventions.length ? `|${JSON.stringify(interventions)}` : '';

	if (sessionId) {
		const key = `api|session|${sessionId}|${GRID_TYPE}${ivPart}|${epoch}|${attempt}`;
		return {
			key,
			center: null,
			radius: Infinity,
			load: () => loadGrid(key, null, epoch, interventions, sessionId)
		};
	}

	const at = anchorFor(center);
	const key = `api|${GRID_TYPE}|${at[0].toFixed(6)},${at[1].toFixed(6)}|${FETCH_RADIUS_M}${ivPart}|${epoch}|${attempt}`;
	return {
		key,
		center: at,
		radius: FETCH_RADIUS_M,
		load: () => loadGrid(key, at, epoch, interventions, null)
	};
}
