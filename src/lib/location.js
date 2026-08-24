// Live "current position" feed — drives both the map marker and the radial
// data selection. No positioning API exists yet, so this mocks one: a point
// walking a small loop near Dalbergplatz. Swap this file's body for a real
// fetch/WebSocket/geolocation source later; keep the subscribe(onUpdate) ->
// unsubscribe contract and the { lng, lat } shape (EPSG:4326) so callers
// don't need to change.

const MOCK_CENTER = { lng: 8.466304325, lat: 49.486004875 }; // Dalbergplatz, Mannheim
const MOCK_WALK_RADIUS = 10; // metres, close to the 50 m data-selection radius so the clip visibly sweeps
const MOCK_STEP = (2 * Math.PI) / 20; // radians per tick — one lap every 20 ticks
const MOCK_INTERVAL_MS = 2000;
const M_PER_DEG = 111320;

export function subscribeLocation(onUpdate) {
	let angle = 0;

	const emit = () => {
		const dLat = (MOCK_WALK_RADIUS * Math.sin(angle)) / M_PER_DEG;
		const dLng =
			(MOCK_WALK_RADIUS * Math.cos(angle)) / M_PER_DEG / Math.cos((MOCK_CENTER.lat * Math.PI) / 180);
		angle += MOCK_STEP;
		onUpdate({ lng: MOCK_CENTER.lng + dLng, lat: MOCK_CENTER.lat + dLat });
	};

	emit();
	const timer = setInterval(emit, MOCK_INTERVAL_MS);
	return () => clearInterval(timer);
}
