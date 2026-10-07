// Grids pushed by the host — the other half of `?unity=1`.
//
// In unity mode the page never asks for a grid (see gridConfig.js's IS_UNITY
// and +page.svelte): the Quest app fetches one itself and hands it over with
//
//   window.postMessage(
//       { source: 'cf-temperature-grid', gridId, ackTarget, t, grid },
//       '*'
//   );
//
// where `grid` is the EnvGrid API response exactly as the service returned
// it, so gridToColumns in envGrid.js reads it unchanged. The full contract,
// written for the Unity developer, is kept outside the repo.
//
// A grid is sent once, unlike pose, so it can be lost — posted before this
// module's listener exists, or into a page that has since reloaded. The host
// therefore keeps re-sending its latest grid until this page acks it through
// the TLab bridge, the same way the host's own latency probe reports back:
//
//   unitySendMessage(ackTarget, 'OnSiteMapGridApplied', '{"gridId":7,"ok":true,…}')
//
// The ack is sent once the grid is actually on the map (gridDrawn, called by
// Heatmap.svelte via +page.svelte), not on receipt — "acked" means "visible".
// A grid that can't be used is acked with ok:false so the host stops
// re-sending data that can never succeed.
//
// Re-sends must stay cheap: they arrive every ~2 s while the first copy may
// still be building, and pose shares this event loop at up to 5 Hz. So a
// re-send of an id already accepted is never stored again; once that id is
// drawn (or rejected) the re-send only repeats the ack, which is how a lost
// ack gets replaced. Everything heavier — gridToColumns, typed arrays,
// polygons — happens later, in gridSource.js's pushSource and data.js.

import { writable } from 'svelte/store';
import { IS_UNITY } from './gridConfig.js';

// Tag on postMessage payloads. Deliberately not the pose tag
// ('cf-temperature-map'): the host's injected latency probe acks every
// message carrying that one, and a grid must not release its pose lock.
const MESSAGE_SOURCE = 'cf-temperature-grid';

// C# method on the host's GameObject that receives the ack.
const ACK_METHOD = 'OnSiteMapGridApplied';

/** Source keys of pushed grids are `${PUSH_KEY_PREFIX}${gridId}` — see gridSource.js's pushSource. */
export const PUSH_KEY_PREFIX = 'push|';

/** @typedef {{centerCoordinate: {latitude: number, longitude: number}, radiusInMeters: number, gridData: (number|null)[][], sessionId?: string, gridType?: string, interventions?: unknown[]}} EnvGridResponse */

/** The newest accepted grid, or null until the host has pushed one. @type {import('svelte/store').Writable<{gridId: number, grid: EnvGridResponse} | null>} */
export const pushedGrid = writable(null);

// gridIds only ever increase on the host's side; anything below the newest
// accepted one is a straggler.
let lastAccepted = -Infinity;
let lastDrawn = -Infinity;
/** @type {{gridId: number, error: string} | null} */
let lastRejected = null;

/** Timing and reply address for the grid currently being built. @type {{gridId: number, ackTarget: string | null, receivedAt: number, deliveryMs: number | null, buildMs: number | null} | null} */
let current = null;

/** Last ack address seen, for re-acks of a message that left it out. @type {string | null} */
let lastAckTarget = null;

/**
 * Sends one ack to the host. Prefers the bridge in the same order the host's
 * latency probe does. With no bridge at all — a desktop browser — it reports
 * to an embedding parent instead, which is how embed-test.html shows acks.
 * @param {string | null} target
 * @param {Record<string, unknown>} payload
 */
function sendAck(target, payload) {
	const message = JSON.stringify(payload);
	const w = /** @type {any} */ (window);
	const bridge = w.TLabWebViewActivity?.unitySendMessage ? w.TLabWebViewActivity : w.tlab?.unitySendMessage ? w.tlab : null;
	try {
		if (bridge && target) {
			bridge.unitySendMessage(target, ACK_METHOD, message);
		} else if (window.parent !== window) {
			window.parent.postMessage({ source: `${MESSAGE_SOURCE}-ack`, method: ACK_METHOD, target, message }, '*');
		} else {
			console.info(`grid push: ack (no Unity bridge) ${message}`);
		}
	} catch (err) {
		console.warn('grid push: ack failed', err);
	}
}

/**
 * What's wrong with a pushed grid, or null if gridToColumns can take it.
 * Only the cheap structural checks — the per-cell work happens in pushSource.
 * @param {any} grid
 */
function problemWith(grid) {
	if (!grid || typeof grid !== 'object') return 'grid is missing';
	const c = grid.centerCoordinate;
	if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return 'bad centerCoordinate';
	if (!Number.isFinite(grid.radiusInMeters) || grid.radiusInMeters <= 0) return 'bad radiusInMeters';
	if (!Array.isArray(grid.gridData) || !Array.isArray(grid.gridData[0])) return 'gridData is not a 2-D array';
	return null;
}

/**
 * @param {number} gridId
 * @param {string | null} target
 * @param {string} error
 */
function reject(gridId, target, error) {
	lastRejected = { gridId, error };
	console.warn(`grid push: rejected grid ${gridId} — ${error}`);
	sendAck(target, { gridId, ok: false, error });
}

function handleMessage(/** @type {MessageEvent} */ event) {
	const data = event.data;
	if (!data || data.source !== MESSAGE_SOURCE) return;
	// Without an id there is nothing to ack and nothing to order by.
	if (!Number.isInteger(data.gridId)) return;

	const gridId = /** @type {number} */ (data.gridId);
	const target = typeof data.ackTarget === 'string' && data.ackTarget ? data.ackTarget : lastAckTarget;
	if (target) lastAckTarget = target;

	if (gridId < lastAccepted) return;

	// A re-send of something already settled: repeat the answer, do no work.
	// This is what replaces an ack lost on the way to the host.
	if (gridId === lastDrawn) return sendAck(target, { gridId, ok: true });
	if (lastRejected?.gridId === gridId) return sendAck(target, { gridId, ok: false, error: lastRejected.error });
	// Accepted but still building — the ack follows once it's drawn.
	if (gridId === lastAccepted) return;

	lastAccepted = gridId;
	const problem = problemWith(data.grid);
	if (problem) return reject(gridId, target, problem);

	current = {
		gridId,
		ackTarget: target,
		receivedAt: performance.now(),
		// Integers throughout: the host reads these with an integer-only parser.
		deliveryMs: typeof data.t === 'number' ? Math.max(0, Math.round(Date.now() - data.t)) : null,
		buildMs: null
	};
	pushedGrid.set({ gridId, grid: data.grid });
}

/**
 * Called by pushSource once the grid has been converted.
 * @param {number} gridId
 * @param {number} ms
 */
export function gridBuilt(gridId, ms) {
	if (current?.gridId === gridId) current.buildMs = Math.round(ms);
}

/**
 * Called by pushSource when the grid couldn't be converted after all.
 * @param {number} gridId
 * @param {string} error
 */
export function gridFailed(gridId, error) {
	if (current?.gridId !== gridId) return;
	reject(gridId, current.ackTarget, error);
	current = null;
}

/**
 * Called with the source key of whatever the heatmap just handed to the map.
 * Heatmap.svelte reports every clip rebuild, so this acks a grid once — the
 * first time it is the one actually drawn — and ignores the rest.
 * @param {string | null} key
 */
export function gridDrawn(key) {
	if (!key?.startsWith(PUSH_KEY_PREFIX) || !current) return;
	const gridId = Number(key.slice(PUSH_KEY_PREFIX.length));
	if (gridId !== current.gridId || gridId <= lastDrawn) return;

	lastDrawn = gridId;
	/** @type {Record<string, unknown>} */
	const ack = { gridId, ok: true };
	if (current.deliveryMs !== null) ack.deliveryMs = current.deliveryMs;
	if (current.buildMs !== null) ack.buildMs = current.buildMs;
	ack.drawMs = Math.round(performance.now() - current.receivedAt);
	sendAck(current.ackTarget, ack);
}

// Only in unity mode: anywhere else a pushed grid has nowhere to go, since
// the page draws what it fetches itself.
if (IS_UNITY && typeof window !== 'undefined') {
	window.addEventListener('message', handleMessage);
}
