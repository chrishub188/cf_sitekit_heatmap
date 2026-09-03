// Live "current position" store — drives both the map marker and the radial
// data selection. A `readable` store: the source starts on first subscriber and
// stops when the last one unsubscribes, so every consumer shares one source.
// Value shape is { lng, lat } (EPSG:4326).
//
// Two sources, chosen at store-start time:
//  - Embedded mode (?lat=&lng= present on the page URL): position is driven
//    externally — e.g. a Unity WebView host page posting live updates. The
//    query params and the postMessage listener live in embedPose.js; this
//    store just re-publishes what arrives there.
//  - Otherwise: the runtime's own Geolocation API (browser/WebView/device).
//
// Both sources pass through the same movement gate: an update is only
// published once the position has actually changed by MIN_MOVE_M. A live feed
// — GPS jitter as much as a host posting at ~5 Hz from a standing user —
// otherwise retriggers the camera, the marker, the site lookup and the heatmap
// clip several times a second for movement nobody can see.
//
// If neither source ever produces a fix (API missing, permission denied, or no
// query params — seen e.g. on standalone Meta Quest, whose WebView often
// doesn't wire up the geolocation permission prompt at all — see conversation),
// FALLBACK_LOCATION is emitted after a short delay so the app still shows
// something instead of staying blank forever. A real fix, if it arrives
// later, always overrides it.

import { readable } from 'svelte/store';
import { isEmbedded, embedLocation } from './embedPose.js';

const GEO_OPTIONS = {
	enableHighAccuracy: true,
	maximumAge: 5000,
	timeout: 15000
};

// // TH-Vorplatz survey site's real centre (see static/geojson/TH_Vorplatz_bbox_300m.geojson) —
// // falling back here lands inside a known site, so the fallback still gets real heatmap data.
const FALLBACK_LOCATION = { lng: 8.483312, lat: 49.469456 };
//Dalbergplatz survey site's real centre (see static/geojson/Dalbergplatz_bbox_300m.geojson) —
//const FALLBACK_LOCATION = { lng: 8.466304325, lat: 49.486004875 };
const FALLBACK_DELAY_MS = 8000;

// Metres a fix has to differ from the last published one to be worth
// publishing. Below the accuracy of any of the input sources, and well below
// the 1 m grid the heatmap is built from.
const MIN_MOVE_M = 1;
const M_PER_DEG = 111320;

// Equirectangular approximation — exact enough by orders of magnitude at the
// metre scale, and it keeps the check to a handful of arithmetic ops.
function movedEnough(from, to) {
	if (!from) return true;
	const dLng = (to.lng - from.lng) * M_PER_DEG * Math.cos((to.lat * Math.PI) / 180);
	const dLat = (to.lat - from.lat) * M_PER_DEG;
	return dLng * dLng + dLat * dLat >= MIN_MOVE_M * MIN_MOVE_M;
}

export const location = readable(null, (set) => {
	let gotFix = false;
	let fallbackSent = false;
	let published = null;

	// The gate is bypassed by the fallback only, which never competes with a
	// real fix (emitFallback bails out once one has arrived).
	const publish = (next) => {
		if (!movedEnough(published, next)) return;
		published = next;
		gotFix = true;
		set(next);
	};

	const emitFallback = () => {
		if (gotFix || fallbackSent) return;
		fallbackSent = true;
		published = FALLBACK_LOCATION;
		set(FALLBACK_LOCATION);
	};

	// Embedded mode: the host drives position. Initial value came from the
	// query params, live updates from postMessage — both already handled in
	// embedPose.js, so there's nothing to start or tear down here beyond the
	// subscription itself.
	if (isEmbedded) {
		return embedLocation.subscribe((value) => {
			if (value) publish(value);
		});
	}

	if (!('geolocation' in navigator)) {
		console.warn('location: Geolocation API not available in this runtime — using fallback location');
		emitFallback();
		return () => {};
	}

	const handlePosition = ({ coords }) => publish({ lng: coords.longitude, lat: coords.latitude });
	const handleError = (err) => {
		console.warn(`location: geolocation error — ${err.message}`);
		emitFallback();
	};

	const fallbackTimer = setTimeout(emitFallback, FALLBACK_DELAY_MS);
	const watchId = navigator.geolocation.watchPosition(handlePosition, handleError, GEO_OPTIONS);

	return () => {
		clearTimeout(fallbackTimer);
		navigator.geolocation.clearWatch(watchId);
	};
});
