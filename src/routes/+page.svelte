<script>
	import SiteMap from '$lib/components/SiteMap.svelte';
	import Heatmap from '$lib/components/Heatmap.svelte';
	import LocationMarker from '$lib/components/LocationMarker.svelte';
	import { customStyle } from '$lib/style.js';
	import { RADIUS, NO_DATA_SIZE, siteForLocation, frameBbox } from '$lib/sites.js';
	import { location } from '$lib/location.js';
	import { heading, needsCompassPrompt, requestHeadingPermission } from '$lib/heading.js';

	let map = $state(null);
	let site = $state(null); // whichever SITES entry's real bbox contains $location, or null if none does

	// Once the first fix arrives, the matched site, the marker, the heatmap's
	// radial clip, and the camera itself all follow the live location.
	$effect(() => {
		if (!$location) return;
		// Only replace `site` when the match actually changes — siteForLocation
		// returns a fresh object/bounds array every call, and reassigning it
		// every tick (even to an equivalent site) would retrigger SiteMap's
		// fitBounds effect and fight the marker's own camera-follow easeTo.
		siteForLocation($location).then((match) => {
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
		} else if ($location && !bounds) {
			bounds = frameBbox([$location.lng, $location.lat], NO_DATA_SIZE);
			bearing = 0;
		}
	});

	// Camera follow — keyed to $location only. Deliberately not re-run on
	// heading changes: compass readings arrive far more often than location
	// fixes, and re-flying the camera on every tick would fight itself.
	$effect(() => {
		if (!map || !$location) return;
		const center = [$location.lng, $location.lat];
		const apply = () => map.easeTo({ center, duration: 1000 });
		// isStyleLoaded() can flicker back to false later (e.g. while new tiles
		// stream in as the camera moves) — 'load' only ever fires once, so once
		// a static style layer is queryable we know the style loaded and can skip that gate.
		if (map.getLayer('street-label') || map.isStyleLoaded()) apply();
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
	{#if map && $location && site}
		<Heatmap {map} url={site.data} center={[$location.lng, $location.lat]} radius={RADIUS} />
	{/if}
	{#if map && $location}
		<LocationMarker {map} location={$location} heading={$heading} />
	{/if}
</div>

{#if $needsCompassPrompt}
	<button class="compass-prompt" onclick={requestHeadingPermission}>
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
