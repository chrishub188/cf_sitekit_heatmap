// Shape and validation for one `Intervention`, as the EnvGrid API's
// `interventions` param expects it: `{objectId?, interventionType,
// gpsCoordinate: {latitude, longitude}, orientationDegree?, isNew}`.
//
// Shared between embedPose.js (parsing the initial URL param and live
// postMessage updates from the host) and routes/api/grid/+server.js
// (validating the request that actually crosses into this server), so the
// shape can't drift between the two call sites.
//
// `parseIntervention` never throws — a bad element is the caller's problem to
// report (a console.warn for a one-time URL param, a 400 for a server
// request), not this module's.

/** @typedef {{objectId?: string, interventionType: string, gpsCoordinate: {latitude: number, longitude: number}, orientationDegree?: number, isNew: boolean}} Intervention */

/**
 * @param {unknown} obj
 * @returns {Intervention | null}
 */
export function parseIntervention(obj) {
	if (!obj || typeof obj !== 'object') return null;
	const { objectId, interventionType, gpsCoordinate, orientationDegree, isNew } =
		/** @type {Record<string, unknown>} */ (obj);

	if (typeof interventionType !== 'string' || interventionType.length === 0 || interventionType.length > 100) {
		return null;
	}
	if (typeof isNew !== 'boolean') return null;

	if (!gpsCoordinate || typeof gpsCoordinate !== 'object') return null;
	const { latitude, longitude } = /** @type {Record<string, unknown>} */ (gpsCoordinate);
	if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
	if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
		return null;
	}

	if (objectId !== undefined && (typeof objectId !== 'string' || objectId.length === 0 || objectId.length > 100)) {
		return null;
	}
	if (orientationDegree !== undefined && (typeof orientationDegree !== 'number' || !Number.isFinite(orientationDegree))) {
		return null;
	}

	/** @type {Intervention} */
	const clean = { interventionType, gpsCoordinate: { latitude, longitude }, isNew };
	if (objectId !== undefined) clean.objectId = objectId;
	if (orientationDegree !== undefined) clean.orientationDegree = orientationDegree;
	return clean;
}

/** Cap on how many interventions a single request may carry — the array
 * round-trips into a query string sent upstream, so it's worth an explicit
 * bound the same way MIN_RADIUS_M/MAX_RADIUS_M bound the radius. */
export const MAX_INTERVENTIONS = 50;
