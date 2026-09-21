<script>
	import SiteMap from '$lib/components/SiteMap.svelte';
	import Heatmap from '$lib/components/Heatmap.svelte';
	import LocationMarker from '$lib/components/LocationMarker.svelte';
	import { customStyle } from '$lib/style.js';
	import { RADIUS, SIZE, frameBbox } from '$lib/viewport.js';
	import { location } from '$lib/location.js';
	import { heading, needsCompassPrompt, requestHeadingPermission } from '$lib/heading.js';
	import { GRID_MODE } from '$lib/gridConfig.js';
	import { apiSource, gridAttempt, gridEpoch } from '$lib/gridSource.js';
	import { embedInterventions, embedSessionId } from '$lib/embedPose.js';

	let map = $state(null);

	// Where the heatmap's readings come from. A new descriptor per fix is fine
	// and deliberate: gridSource keeps the request anchored until the visitor
	// has walked far enough to need a new grid, so the *key* only changes when
	// a fetch is actually warranted, and Heatmap gates on the key.
	let source = $derived.by(() => {
		if (!$location || GRID_MODE === 'off') return null;
		return apiSource([$location.lng, $location.lat], $gridEpoch, $gridAttempt, $embedInterventions, $embedSessionId);
	});

	// The camera frames a SIZE-metre crop around the visitor, set once on the
	// first fix: frameBbox returns a fresh array each call, and re-framing on
	// every GPS jitter would fight the marker's own camera-follow below. There
	// is no site-specific crop any more — data is no longer confined to a site,
	// so the frame follows the person rather than a surveyed rectangle.
	let bounds = $state(null);

	$effect(() => {
		if ($location && !bounds) bounds = frameBbox([$location.lng, $location.lat], SIZE);
	});

	// Camera follow — keyed to $location only. Deliberately not re-run on
	// heading changes: compass readings arrive far more often than location
	// fixes, and re-flying the camera on every tick would fight itself.
	//
	// jumpTo rather than an animated move: an easeTo per fix keeps the map
	// permanently in an animation, re-rendering and re-requesting tiles the
	// whole time, and with a live feed each new one aborts the last one
	// mid-flight anyway. location.js only publishes a fix once the visitor has
	// moved a metre, so the jump is no more visible than the 100 ms ease was.
	$effect(() => {
		if (!map || !$location) return;
		const center = [$location.lng, $location.lat];
		const apply = () => map.jumpTo({ center });
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
		<SiteMap mapStyle={customStyle} {bounds} onready={(m) => (map = m)} />
	{/if}
	{#if map && $location && source}
		<Heatmap {map} {source} center={[$location.lng, $location.lat]} radius={RADIUS} />
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
