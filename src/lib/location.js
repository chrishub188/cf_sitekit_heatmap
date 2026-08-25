// Live "current position" store — drives both the map marker and the radial
// data selection. Sourced from the runtime's Geolocation API (browser/WebView/
// device). A `readable` store: the watch starts on first subscriber and stops
// when the last one unsubscribes, so every consumer shares one GPS watch.
// Value shape is { lng, lat } (EPSG:4326).
//
// If the API is missing, permission is denied, or no fix ever arrives (seen
// e.g. on standalone Meta Quest, whose WebView often doesn't wire up the
// geolocation permission prompt at all — see conversation), FALLBACK_LOCATION
// is emitted after a short delay so the app still shows something instead of
// staying blank forever. A real fix, if it arrives later, always overrides it.

import { readable } from 'svelte/store';

const GEO_OPTIONS = {
	enableHighAccuracy: true,
	maximumAge: 5000,
	timeout: 15000
};

// TH-Vorplatz survey site's real centre (see static/geojson/TH_Vorplatz_bbox_300m.geojson) —
// falling back here lands inside a known site, so the fallback still gets real heatmap data.
const FALLBACK_LOCATION = { lng: 8.483312, lat: 49.469456 };
const FALLBACK_DELAY_MS = 8000;

export const location = readable(null, (set) => {
	let gotFix = false;
	let fallbackSent = false;

	const emitFallback = () => {
		if (gotFix || fallbackSent) return;
		fallbackSent = true;
		set(FALLBACK_LOCATION);
	};

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
