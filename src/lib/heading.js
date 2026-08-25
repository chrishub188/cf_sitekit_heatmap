// Live compass heading feed — drives the direction cone on the map marker.
// Sourced from the runtime's DeviceOrientation API. Keeps the same
// subscribe(onUpdate) -> unsubscribe shape as location.js; onUpdate receives
// degrees clockwise from true north (0-360).
//
// iOS 13+ gates this behind a permission that can only be requested from a
// user gesture, which this module doesn't have (it's called from onMount, not
// a tap) — so on iOS it typically stays silent unless already granted. Any
// runtime where no reading ever arrives falls back to FALLBACK_HEADING
// (north), mirroring location.js's fallback location.

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

export function subscribeHeading(onUpdate) {
	let gotFix = false;
	let fallbackSent = false;

	const emitFallback = () => {
		if (gotFix || fallbackSent) return;
		fallbackSent = true;
		onUpdate(FALLBACK_HEADING);
	};

	if (typeof DeviceOrientationEvent === 'undefined') {
		console.warn('heading: DeviceOrientation API not available in this runtime — using fallback heading');
		emitFallback();
		return () => {};
	}

	const handleOrientation = (event) => {
		const value = toHeading(event);
		if (value == null) return;
		gotFix = true;
		onUpdate(value);
	};

	const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
	const start = () => window.addEventListener(eventName, handleOrientation);

	if (typeof DeviceOrientationEvent.requestPermission === 'function') {
		DeviceOrientationEvent.requestPermission()
			.then((state) => {
				if (state === 'granted') start();
				else console.warn('heading: motion/orientation permission not granted — using fallback heading');
			})
			.catch((err) => console.warn(`heading: permission request failed — ${err.message}`));
	} else {
		start();
	}

	const fallbackTimer = setTimeout(emitFallback, FALLBACK_DELAY_MS);

	return () => {
		clearTimeout(fallbackTimer);
		window.removeEventListener(eventName, handleOrientation);
	};
}
