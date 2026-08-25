// Live "current position" feed — drives both the map marker and the radial
// data selection. Sourced from the runtime's Geolocation API (browser/WebView/
// device). Keeps the subscribe(onUpdate) -> unsubscribe contract and the
// { lng, lat } shape (EPSG:4326) so callers don't need to change. If the API
// is missing or the user denies/never grants permission, onUpdate simply
// never fires — callers should treat "no fix yet" as their no-data state.

const GEO_OPTIONS = {
	enableHighAccuracy: true,
	maximumAge: 5000,
	timeout: 15000
};

export function subscribeLocation(onUpdate) {
	if (!('geolocation' in navigator)) {
		console.warn('location: Geolocation API not available in this runtime');
		return () => {};
	}

	const handlePosition = ({ coords }) => onUpdate({ lng: coords.longitude, lat: coords.latitude });
	const handleError = (err) => console.warn(`location: geolocation error — ${err.message}`);

	const watchId = navigator.geolocation.watchPosition(handlePosition, handleError, GEO_OPTIONS);
	return () => navigator.geolocation.clearWatch(watchId);
}
