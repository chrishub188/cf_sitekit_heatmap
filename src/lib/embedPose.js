// Embedded ("external") pose input — the single place that knows how a host
// app drives this map's position and bearing.
//
// A host such as a Unity/Meta Quest app embeds the page in an <iframe>, seeds
// the initial pose through query params, and then posts live updates:
//
//   iframeEl.contentWindow.postMessage(
//       { source: 'cf-temperature-map', lat, lng, heading, id },
//       '*'
//   );
//
// Updates arrive at roughly 5 Hz, which is why this module exists at all:
// there is exactly ONE `message` listener, registered at import time rather
// than per store subscription, and it does nothing but write to two stores.
// No fetch, no map work, no layer rebuilds, and no throttling either — every
// message is applied immediately. Deciding what is worth acting on belongs
// downstream, where it can be judged by movement rather than by elapsed time:
// see location.js's movement gate and Heatmap.svelte's clip gate.
//
// Which inputs are honoured is decided once, at load, from the query params —
// unchanged from when the two stores each had their own listener, because the
// host app depends on exactly this behaviour:
//   - `lat` AND `lng` present  -> position comes from the host (embedded mode)
//   - `heading` present        -> bearing comes from the host
// Either can be used without the other, and a posted field whose param was
// absent at load is ignored. The sender's origin is intentionally not validated.

import { writable } from 'svelte/store';

// Tag on postMessage payloads so unrelated `message` events (devtools,
// extensions, other embedders) are ignored.
const MESSAGE_SOURCE = 'cf-temperature-map';

const params =
	typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

const normalizeHeading = (/** @type {number} */ deg) => ((deg % 360) + 360) % 360;

function readInitialLocation() {
	const lat = Number(params.get('lat'));
	const lng = Number(params.get('lng'));
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	return { lat, lng };
}

function readInitialHeading() {
	const value = Number(params.get('heading'));
	return Number.isFinite(value) ? normalizeHeading(value) : null;
}

/** True when the host drives position: both `lat` and `lng` were on the URL. */
export const isEmbedded = params.get('lat') !== null && params.get('lng') !== null;
/** True when the host drives bearing: `heading` was on the URL. */
export const hasHeadingParam = params.get('heading') !== null;

export const initialLocation = isEmbedded ? readInitialLocation() : null;
export const initialHeading = hasHeadingParam ? readInitialHeading() : null;

/** Latest host-supplied position, or null while none has arrived. */
export const embedLocation = writable(initialLocation);
/** Latest host-supplied bearing in degrees clockwise from true north, or null. */
export const embedHeading = writable(initialHeading);

// Messages can arrive out of order; `id`, when the host sends one, is a
// monotonic counter, so anything older than what we've already applied is a
// straggler and gets dropped.
let lastId = -Infinity;

function handleMessage(/** @type {MessageEvent} */ event) {
	const data = event.data;
	if (!data || data.source !== MESSAGE_SOURCE) return;

	if (typeof data.id === 'number') {
		if (data.id < lastId) return;
		lastId = data.id;
	}

	// Heading first, and never deferred: it's a single number going into a
	// store, and any delay here is delay the visitor sees when they turn.
	if (hasHeadingParam && typeof data.heading === 'number') {
		embedHeading.set(normalizeHeading(data.heading));
	}

	// Position is the head of a chain of expensive work (camera, marker,
	// heatmap clip), but it isn't filtered here either — location.js's movement
	// gate drops updates by whether the visitor actually moved rather than by
	// how much time passed, which caps the rate at walking pace however fast a
	// host posts, and costs nothing at all while they stand still.
	if (isEmbedded && typeof data.lat === 'number' && typeof data.lng === 'number') {
		embedLocation.set({ lat: data.lat, lng: data.lng });
	}
}

if (typeof window !== 'undefined' && (isEmbedded || hasHeadingParam)) {
	window.addEventListener('message', handleMessage);
}
