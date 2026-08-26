// Live "current position" store — drives both the map marker and the radial
// data selection. A `readable` store: the watch starts on first subscriber and
// stops when the last one unsubscribes, so every consumer shares one source.
// Value shape is { lng, lat } (EPSG:4326).
//
// Two sources, chosen at store-start time:
//  - Embedded mode (?lat=&lng= present on the page URL): position is driven
//    externally — e.g. a Unity WebView host page posting live updates via
//    `iframe.contentWindow.postMessage({ source: 'cf-temperature-map', lat, lng })`.
//    No page reload needed; see the branch below.
//  - Otherwise: the runtime's own Geolocation API (browser/WebView/device).
//
// If neither ever produces a fix (API missing, permission denied, or no query
// params — seen e.g. on standalone Meta Quest, whose WebView often doesn't
// wire up the geolocation permission prompt at all — see conversation),
// FALLBACK_LOCATION is emitted after a short delay so the app still shows
// something instead of staying blank forever. A real fix, if it arrives
// later, always overrides it.

import { readable } from 'svelte/store';
import { rafThrottle } from './rafThrottle.js';

const GEO_OPTIONS = {
	enableHighAccuracy: true,
	maximumAge: 5000,
	timeout: 15000
};

// TH-Vorplatz survey site's real centre (see static/geojson/TH_Vorplatz_bbox_300m.geojson) —
// falling back here lands inside a known site, so the fallback still gets real heatmap data.
const FALLBACK_LOCATION = { lng: 8.483312, lat: 49.469456 };
const FALLBACK_DELAY_MS = 8000;

// Tag on postMessage payloads so unrelated `message` events (devtools,
// extensions, other embedders) are ignored.
const MESSAGE_SOURCE = 'cf-temperature-map';

export const location = readable(null, (set) => {
	let gotFix = false;
	let fallbackSent = false;

	const emitFallback = () => {
		if (gotFix || fallbackSent) return;
		fallbackSent = true;
		set(FALLBACK_LOCATION);
	};

	// Embedded mode: an lng/lat query param on the page URL means the host
	// (e.g. a Unity WebView) is driving position, not the device's own GPS.
	// Initial value comes from the query params; live updates arrive via
	// postMessage from the parent frame so the iframe never has to reload.
	const params = new URLSearchParams(window.location.search);
	const lat0 = params.get('lat');
	const lng0 = params.get('lng');

	if (lat0 !== null && lng0 !== null) {
		const initial = { lat: Number(lat0), lng: Number(lng0) };
		if (Number.isFinite(initial.lat) && Number.isFinite(initial.lng)) {
			gotFix = true;
			set(initial);
		}

		const handleMessage = rafThrottle((/** @type {MessageEvent} */ event) => {
			const data = event.data;
			if (!data || data.source !== MESSAGE_SOURCE) return;
			if (typeof data.lat === 'number' && typeof data.lng === 'number') {
				gotFix = true;
				set({ lat: data.lat, lng: data.lng });
			}
		});
		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	}

	if (!('geolocation' in navigator)) {
		console.warn('location: Geolocation API not available in this runtime — using fallback location');
		emitFallback();
		return () => {};
	}

	const handlePosition = ({ coords }) => {
		gotFix = true;
		set({ lng: coords.longitude, lat: coords.latitude });
	};
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
