// Relays a grid request — a site's baseline, or a rerun with trees — to the
// simulation backend. The backend is plain
// http without CORS, so a browser on the deployed (https) app can't reach it;
// this route can. ENV_GRID_API_URL overrides the backend base URL.

import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { GRID_TYPES, envGridQuery } from '$lib/envgrid.js';

const DEFAULT_API_URL = 'http://projects.dfki.uni-kl.de/craftingfutures_serverbackend/';
const TIMEOUT_MS = 120_000; // a recalculation with many trees is slow
const MAX_RADIUS_M = 500;
const MAX_INTERVENTIONS = 5000;
// Values land unquoted in the backend's query, so anything beyond a bare enum
// or a plain number could change what it parses.
const ENUM = /^[A-Z][A-Z0-9_]*$/;

/** @param {unknown} v @param {number} limit */
const isCoord = (v, limit) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;

/** @param {any} body @returns {import('$lib/envgrid.js').EnvGridRequest | null} */
function validate(body) {
	const { center, radius, gridType, interventions = [] } = body ?? {};
	if (!Array.isArray(center) || !isCoord(center[0], 180) || !isCoord(center[1], 90)) return null;
	if (typeof radius !== 'number' || !(radius > 0 && radius <= MAX_RADIUS_M)) return null;
	if (!GRID_TYPES.includes(gridType)) return null;
	if (!Array.isArray(interventions) || interventions.length > MAX_INTERVENTIONS) return null;
	const trees = [];
	for (const t of interventions) {
		if (typeof t?.type !== 'string' || !ENUM.test(t.type)) return null;
		if (!isCoord(t.lat, 90) || !isCoord(t.lon, 180) || typeof t.isNew !== 'boolean') return null;
		trees.push({ type: t.type, lat: t.lat, lon: t.lon, isNew: t.isNew });
	}
	return { center: [center[0], center[1]], radius, gridType, interventions: trees };
}

export async function POST({ request }) {
	const payload = validate(await request.json().catch(() => null));
	if (!payload) error(400, 'Invalid simulation request');

	const base = (env.ENV_GRID_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
	const target = `${base}/calculateEnvGrid?${envGridQuery(payload)}`;

	let res;
	try {
		res = await fetch(target, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	} catch (err) {
		console.warn('env-grid: backend unreachable', err);
		error(502, 'Simulation service unreachable');
	}
	if (!res.ok) {
		console.warn(`env-grid: backend answered ${res.status}`, await res.text().catch(() => ''));
		error(502, `Simulation service answered ${res.status}`);
	}
	return new Response(res.body, { headers: { 'content-type': 'application/json' } });
}
