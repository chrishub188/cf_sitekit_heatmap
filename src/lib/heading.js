// Live compass heading store — drives the direction cone on the map marker.
// Sourced from the runtime's DeviceOrientation API. A `readable` store, same
// sharing behaviour as location.js: the listener starts on first subscriber
// and stops when the last one unsubscribes. Value is degrees clockwise from
// true north (0-360), or null if there's no heading to show.
//
// iOS 13+ (every browser there, not just Safari — they're all WebKit) gates
// this behind a permission that can only be requested from a direct user
// gesture. The auto-attempt below (fired when the store starts, not a tap)
// will usually be silently denied on a first visit — `needsCompassPrompt`
// flips true so a caller can show an "Enable compass" button, and
// `requestHeadingPermission()` retries from that button's actual click/tap.
// Any runtime where no real reading ever arrives falls back to
// FALLBACK_HEADING (north), mirroring location.js's fallback location —
// except in embedded mode (location.js's own lat/lng query params present)
// with no heading param: there the host is driving position but not bearing,
// so this device's own compass would show the wrong direction entirely. That
// case stays null forever — no wedge, marker shows location only.

import { readable, writable } from 'svelte/store';
import { rafThrottle } from './rafThrottle.js';

const FALLBACK_HEADING = 0; // degrees, true north
const FALLBACK_DELAY_MS = 3000;

// Tag on postMessage payloads so unrelated `message` events (devtools,
// extensions, other embedders) are ignored.
const MESSAGE_SOURCE = 'cf-temperature-map';

// iOS Safari's webkitCompassHeading is already relative to true north.
// Standard `alpha` (from deviceorientationabsolute, or deviceorientation with
// event.absolute) increases counter-clockwise from the device's start
// orientation, so it's flipped to a clockwise-from-north compass heading.
function toHeading(event) {
	if (typeof event.webkitCompassHeading === 'number') return event.webkitCompassHeading;
	if (event.absolute && typeof event.alpha === 'number') return (360 - event.alpha) % 360;
	return null;
}

// True while iOS still needs an explicit tap to unlock real compass readings.
export const needsCompassPrompt = writable(false);

// Reassigned by the store's start function once it runs; requestHeadingPermission
// just forwards to whatever it's currently bound to.
let requestPermissionImpl = async () => false;

export const heading = readable(null, (set) => {
	let gotFix = false;
	let fallbackSent = false;

	const emitFallback = () => {
		if (gotFix || fallbackSent) return;
		fallbackSent = true;
		set(FALLBACK_HEADING);
	};

	// Embedded mode: a heading query param on the page URL means the host
	// (e.g. a Unity WebView) is driving bearing, not the device's own compass.
	// Initial value comes from the query param; live updates arrive via
	// postMessage from the parent frame so the iframe never has to reload.
	// Independent of location.js's own query-param check, so either source
	// can come from the device and the other from the host during testing.
	const params = new URLSearchParams(window.location.search);
	const heading0 = params.get('heading');

	if (heading0 !== null) {
		const value = Number(heading0);
		if (Number.isFinite(value)) {
			gotFix = true;
			set(((value % 360) + 360) % 360);
		}
		needsCompassPrompt.set(false);
		requestPermissionImpl = async () => true; // nothing to grant in external mode

		const handleMessage = rafThrottle((/** @type {MessageEvent} */ event) => {
			const data = event.data;
			if (!data || data.source !== MESSAGE_SOURCE) return;
			if (typeof data.heading === 'number') {
				gotFix = true;
				set(((data.heading % 360) + 360) % 360);
			}
		});
		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	}

	// Embedded mode (location.js's own lat/lng query params present) but no
	// heading param: the host is driving position, not bearing. Falling
	// through to this device's own compass would show a direction that has
	// nothing to do with the visitor the host is tracking, so just leave the
	// heading as null — marker shows location only, no wedge.
	if (params.get('lat') !== null && params.get('lng') !== null) {
		needsCompassPrompt.set(false);
		requestPermissionImpl = async () => true;
		return () => {};
	}

	if (typeof DeviceOrientationEvent === 'undefined') {
		console.warn('heading: DeviceOrientation API not available in this runtime — using fallback heading');
		emitFallback();
		requestPermissionImpl = async () => false;
		return () => {};
	}

	const handleOrientation = (event) => {
		const value = toHeading(event);
		if (value == null) return;
		gotFix = true;
		set(value);
	};

	const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
	let listening = false;
	const start = () => {
		if (listening) return;
		listening = true;
		window.addEventListener(eventName, handleOrientation);
	};

	const gated = typeof DeviceOrientationEvent.requestPermission === 'function';
	needsCompassPrompt.set(gated);

	// Shared by the automatic attempt below and any later gesture-triggered
	// retry via requestHeadingPermission — both just need to start listening
	// on a grant.
	requestPermissionImpl = async () => {
		if (!gated) {
			start();
			return true;
		}
		try {
			const state = await DeviceOrientationEvent.requestPermission();
			const granted = state === 'granted';
			if (granted) {
				start();
				needsCompassPrompt.set(false);
			} else {
				console.warn('heading: motion/orientation permission not granted — using fallback heading');
			}
			return granted;
		} catch (err) {
			console.warn(`heading: permission request failed — ${err.message}`);
			return false;
		}
	};

	requestPermissionImpl();

	const fallbackTimer = setTimeout(emitFallback, FALLBACK_DELAY_MS);

	return () => {
		clearTimeout(fallbackTimer);
		window.removeEventListener(eventName, handleOrientation);
	};
});

// Retries the permission prompt from an actual tap/click — see the
// "Enable compass" prompt in +page.svelte.
export function requestHeadingPermission() {
	return requestPermissionImpl();
}
