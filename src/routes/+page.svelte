<script>
	import { onMount } from 'svelte';
	import SiteMap from '$lib/components/SiteMap.svelte';
	import Heatmap from '$lib/components/Heatmap.svelte';
	import { customStyle } from '$lib/style.js';
	import { RADIUS, NO_DATA_SIZE, siteForLocation, frameBbox } from '$lib/sites.js';
	import { subscribeLocation } from '$lib/location.js';
	import { subscribeHeading } from '$lib/heading.js';

	const MARKER_SOURCE_ID = 'sites';
	const M_PER_DEG = 111320;

	let map = $state(null);
	let location = $state(null); // { lng, lat } (EPSG:4326) — null until the first fix arrives
	let site = $state(null); // whichever SITES entry's real bbox contains `location`, or null if none does
	let heading = $state(0); // degrees clockwise from true north — defaults to north until/unless a real reading arrives
	let headingHandle; // subscribeHeading's return value — carries .requestPermission() for the iOS gesture prompt below
	let showCompassPrompt = $state(false); // iOS 13+ only: compass access needs a tap, not just page load

	// Once the first fix arrives, the matched site, the marker, the heatmap's
	// radial clip, and the camera itself all follow the live location.
	onMount(() => subscribeLocation((loc) => (location = loc)));
	onMount(() => {
		headingHandle = subscribeHeading(
			(h) => (heading = h),
			(granted) => {
				if (granted) showCompassPrompt = false;
			}
		);
		showCompassPrompt = !!headingHandle.needsPermission;
		return headingHandle;
	});

	function offsetMetres([lng, lat], bearingDeg, distanceM) {
		const rad = (bearingDeg * Math.PI) / 180;
		const dLat = (distanceM * Math.cos(rad)) / M_PER_DEG;
		const dLng = (distanceM * Math.sin(rad)) / M_PER_DEG / Math.cos((lat * Math.PI) / 180);
		return [lng + dLng, lat + dLat];
	}

	// Soft "flashlight beam" wedge pointing at `headingDeg`, built from
	// concentric annular bands whose opacity fades with distance from the
	// marker (closest = most intense) — MapLibre fill layers can't express a
	// true radial gradient, so this approximates one with stepped bands. The
	// innermost band already has width at its base (nonzero inner radius)
	// rather than converging to a sharp point, so it isn't a dagger.
	const HEADING_INNER_RADIUS_M = 1;
	const HEADING_OUTER_RADIUS_M = 10;
	const HEADING_HALF_ANGLE = 45; // degrees either side of heading
	const HEADING_ARC_SEGMENTS = 10;
	const HEADING_BANDS = 16; // more, finer bands read as a smooth fade instead of visible steps
	const HEADING_MAX_OPACITY = 0.8; // nearest the marker
	const HEADING_MIN_OPACITY = 0.2; // at the outer edge

	function headingArc(center, headingDeg, radiusM) {
		const start = headingDeg - HEADING_HALF_ANGLE;
		const end = headingDeg + HEADING_HALF_ANGLE;
		return Array.from({ length: HEADING_ARC_SEGMENTS + 1 }, (_, i) => {
			const bearing = start + ((end - start) * i) / HEADING_ARC_SEGMENTS;
			return offsetMetres(center, bearing, radiusM);
		});
	}

	function headingBands(center, headingDeg) {
		const span = HEADING_OUTER_RADIUS_M - HEADING_INNER_RADIUS_M;
		return Array.from({ length: HEADING_BANDS }, (_, i) => {
			const rInner = HEADING_INNER_RADIUS_M + (span * i) / HEADING_BANDS;
			const rOuter = HEADING_INNER_RADIUS_M + (span * (i + 1)) / HEADING_BANDS;
			const outerArc = headingArc(center, headingDeg, rOuter);
			const innerArc = headingArc(center, headingDeg, rInner).reverse();
			const ring = [...outerArc, ...innerArc, outerArc[0]];
			const t = i / (HEADING_BANDS - 1); // 0 nearest the marker, 1 at the outer edge
			const opacity = HEADING_MAX_OPACITY + (HEADING_MIN_OPACITY - HEADING_MAX_OPACITY) * t;
			return { ring, opacity };
		});
	}

	$effect(() => {
		if (!location) return;
		// Only replace `site` when the match actually changes — siteForLocation
		// returns a fresh object/bounds array every call, and reassigning it
		// every tick (even to an equivalent site) would retrigger SiteMap's
		// fitBounds effect and fight the marker's own camera-follow easeTo.
		siteForLocation(location).then((match) => {
			if (match?.id !== site?.id) site = match;
		});
	});

	// No matched site means no survey data for the current fix — still frame
	// the camera around the visitor once so the marker has somewhere to sit.
	// Only set on the first no-site fix (not every tick): frameBbox returns a
	// fresh array each call, and re-flying the camera on every GPS jitter would
	// fight the marker's own camera-follow easeTo, same as the `site` guard above.
	let bounds = $state(null);
	let bearing = $state(0);

	$effect(() => {
		if (site) {
			bounds = site.bounds;
			bearing = site.bearing;
		} else if (location && !bounds) {
			bounds = frameBbox([location.lng, location.lat], NO_DATA_SIZE);
			bearing = 0;
		}
	});

	// Camera follow — keyed to `location` only. Deliberately not re-run on
	// `heading` changes: compass readings arrive far more often than location
	// fixes, and re-flying the camera on every tick would fight itself.
	$effect(() => {
		if (!map || !location) return;
		const center = [location.lng, location.lat];
		const apply = () => map.easeTo({ center, duration: 1000 });
		// isStyleLoaded() can flicker back to false later (e.g. while new tiles
		// stream in as the camera moves) — 'load' only ever fires once, so once
		// the source is queryable we know the style loaded and can skip that gate.
		if (map.getSource(MARKER_SOURCE_ID) || map.isStyleLoaded()) apply();
		else map.once('load', apply);
	});

	// Marker + heading cone geometry — follows both `location` and `heading`,
	// but only ever rewrites the source data, never the camera.
	$effect(() => {
		if (!map || !location) return;
		const center = [location.lng, location.lat];
		const data = {
			type: 'FeatureCollection',
			features: [
				...headingBands(center, heading).map(({ ring, opacity }) => ({
					type: 'Feature',
					properties: { kind: 'heading', opacity },
					geometry: { type: 'Polygon', coordinates: [ring] }
				})),
				{
					type: 'Feature',
					properties: { kind: 'marker' },
					geometry: { type: 'Point', coordinates: center }
				}
			]
		};
		const apply = () => map.getSource(MARKER_SOURCE_ID)?.setData(data);
		if (map.getSource(MARKER_SOURCE_ID) || map.isStyleLoaded()) apply();
		else map.once('load', apply);
	});
</script>

<svelte:head>
	<title>Site plan</title>
</svelte:head>

<div class="stage">
	{#if bounds}
		<SiteMap mapStyle={customStyle} {bounds} {bearing} onready={(m) => (map = m)} />
	{/if}
	{#if map && location && site}
		<Heatmap {map} url={site.data} center={[location.lng, location.lat]} radius={RADIUS} />
	{/if}
</div>

{#if showCompassPrompt}
	<button class="compass-prompt" onclick={() => headingHandle.requestPermission()}>
		Enable compass
	</button>
{/if}

<style>
	.stage {
		position: fixed;
		inset: 0;
	}

	.compass-prompt {
		position: fixed;
		top: calc(env(safe-area-inset-top, 0px) + 16px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 1;
		padding: 8px 16px;
		border: 1px solid #d5c9b1;
		border-radius: 999px;
		background: #f1ebdf;
		color: #9a9081;
		font: inherit;
		font-size: 14px;
		cursor: pointer;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
	}

	:global(body) {
		margin: 0;
		background: #f1ebdf;
	}
</style>
