<script>
	import SiteMap from '$lib/components/SiteMap.svelte';
	import SiteSwitch from '$lib/components/SiteSwitch.svelte';
	import ResolutionSwitch from '$lib/components/ResolutionSwitch.svelte';
	import FilteredToggle from '$lib/components/FilteredToggle.svelte';
	import ClipShapeSwitch from '$lib/components/ClipShapeSwitch.svelte';
	import Heatmap from '$lib/components/Heatmap.svelte';
	import Legend from '$lib/components/Legend.svelte';
	import { customStyle } from '$lib/style.js';
	import { SITES, RESOLUTIONS, CLIP_SHAPES, RADIUS } from '$lib/sites.js';

	let active = $state(0);
	let resolution = $state('5m');
	let showFiltered = $state(false);
	let clipShape = $state('square');
	let map = $state(null);
	let domain = $state(null);
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
		<Heatmap
			{map}
			url={site.data[resolution]}
			{crs}
			bounds={site.bounds}
			filterUrl={site.filterUrl}
			center={site.center}
			radius={RADIUS}
			{clipShape}
			{showFiltered}
			ondomain={(d) => (domain = d)}
		/>
	{/if}
	<SiteSwitch sites={SITES} {active} onselect={(i) => (active = i)} />
	<ResolutionSwitch resolutions={RESOLUTIONS} active={resolution} onselect={(id) => (resolution = id)} />
	<ClipShapeSwitch shapes={CLIP_SHAPES} active={clipShape} onselect={(id) => (clipShape = id)} />
	<FilteredToggle active={showFiltered} onselect={(v) => (showFiltered = v)} />
	{#if domain}
		<Legend min={domain.min} max={domain.max} />
	{/if}
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
