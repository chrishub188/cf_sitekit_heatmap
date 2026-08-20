<script>
	import SiteMap from '$lib/components/SiteMap.svelte';
	import SiteSwitch from '$lib/components/SiteSwitch.svelte';
	import ResolutionSwitch from '$lib/components/ResolutionSwitch.svelte';
	import Heatmap from '$lib/components/Heatmap.svelte';
	import { customStyle } from '$lib/style.js';
	import { SITES, RESOLUTIONS } from '$lib/sites.js';

	let active = $state(0);
	let resolution = $state('5m');
	let map = $state(null);
	const site = $derived(SITES[active]);
	const crs = $derived(RESOLUTIONS.find((r) => r.id === resolution).crs);
</script>

<svelte:head>
	<title>Site plans</title>
</svelte:head>

<div class="stage">
	<SiteMap
		mapStyle={customStyle}
		bounds={site.bounds}
		bearing={site.bearing}
		onready={(m) => (map = m)}
	/>
	{#if map}
		<Heatmap {map} url={site.data[resolution]} {crs} bounds={site.bounds} />
	{/if}
	<SiteSwitch sites={SITES} {active} onselect={(i) => (active = i)} />
	<ResolutionSwitch resolutions={RESOLUTIONS} active={resolution} onselect={(id) => (resolution = id)} />
</div>

<style>
	.stage {
		position: fixed;
		inset: 0;
	}

	:global(body) {
		margin: 0;
		background: #f1ebdf;
	}
</style>
