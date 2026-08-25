// Live compass heading feed — drives the direction cone on the map marker.
// Sourced from the runtime's DeviceOrientation API. Keeps the same
// subscribe(onUpdate) -> unsubscribe shape as location.js; onUpdate receives
// degrees clockwise from true north (0-360).
//
// iOS 13+ (every browser there, not just Safari — they're all WebKit) gates
// this behind a permission that can only be requested from a direct user
// gesture. The auto-attempt below (from onMount, not a tap) will usually be
// silently denied on a first visit, but the returned unsubscribe function
// also carries `.requestPermission()` and `.needsPermission` so a caller can
// retry from an actual click/tap — see the "Enable compass" prompt in
// +page.svelte. Any runtime where no real reading ever arrives falls back to
// FALLBACK_HEADING (north), mirroring location.js's fallback location.

const FALLBACK_HEADING = 0; // degrees, true north
const FALLBACK_DELAY_MS = 3000;

// iOS Safari's webkitCompassHeading is already relative to true north.
// Standard `alpha` (from deviceorientationabsolute, or deviceorientation with
// event.absolute) increases counter-clockwise from the device's start
// orientation, so it's flipped to a clockwise-from-north compass heading.
function toHeading(event) {
	if (typeof event.webkitCompassHeading === 'number') return event.webkitCompassHeading;
	if (event.absolute && typeof event.alpha === 'number') return (360 - event.alpha) % 360;
	return null;
}

export function subscribeHeading(onUpdate, onPermissionResolved) {
	let gotFix = false;
	let fallbackSent = false;
	let listening = false;

	const emitFallback = () => {
		if (gotFix || fallbackSent) return;
		fallbackSent = true;
		onUpdate(FALLBACK_HEADING);
	};

	if (typeof DeviceOrientationEvent === 'undefined') {
		console.warn('heading: DeviceOrientation API not available in this runtime — using fallback heading');
		emitFallback();
		const noop = () => {};
		noop.needsPermission = false;
		noop.requestPermission = async () => false;
		return noop;
	}

	const handleOrientation = (event) => {
		const value = toHeading(event);
		if (value == null) return;
		gotFix = true;
		onUpdate(value);
	};

	const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
	const start = () => {
		if (listening) return;
		listening = true;
		window.addEventListener(eventName, handleOrientation);
	};

	const gated = typeof DeviceOrientationEvent.requestPermission === 'function';

	// Shared by the automatic onMount attempt below and any later gesture-
	// triggered retry — both just need to start listening on a grant.
	async function requestPermission() {
		if (!gated) {
			start();
			onPermissionResolved?.(true);
			return true;
		}
		try {
			const state = await DeviceOrientationEvent.requestPermission();
			const granted = state === 'granted';
			if (granted) start();
			else console.warn('heading: motion/orientation permission not granted — using fallback heading');
			onPermissionResolved?.(granted);
			return granted;
		} catch (err) {
			console.warn(`heading: permission request failed — ${err.message}`);
			onPermissionResolved?.(false);
			return false;
		}
	}

	requestPermission();

	const fallbackTimer = setTimeout(emitFallback, FALLBACK_DELAY_MS);

	const unsubscribe = () => {
		clearTimeout(fallbackTimer);
		window.removeEventListener(eventName, handleOrientation);
	};
	unsubscribe.needsPermission = gated;
	unsubscribe.requestPermission = requestPermission;
	return unsubscribe;
}
