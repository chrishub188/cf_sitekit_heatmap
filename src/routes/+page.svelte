<script>
	import SiteMap from '$lib/components/SiteMap.svelte';
	import SiteSwitch from '$lib/components/SiteSwitch.svelte';
	import ResolutionSwitch from '$lib/components/ResolutionSwitch.svelte';
	import FilteredToggle from '$lib/components/FilteredToggle.svelte';
	import ClipShapeSwitch from '$lib/components/ClipShapeSwitch.svelte';
	import ControlPanel from '$lib/components/ControlPanel.svelte';
	import Heatmap from '$lib/components/Heatmap.svelte';
	import Legend from '$lib/components/Legend.svelte';
	import { customStyle } from '$lib/style.js';
	import { SITES, RESOLUTIONS, CLIP_SHAPES, RADIUS } from '$lib/sites.js';

	let active = $state(0);
	let resolution = $state('5m');
	let showFiltered = $state(false);
	let clipShape = $state('square');
	let map = $state(null);
	/** @type {{ min: number, max: number } | null} */
	let domain = $state(null);
	// Hand-set colour scale limits. Null means "follow the data", and they
	// deliberately survive a site or resolution switch so two datasets can be
	// compared on one fixed scale.
	/** @type {number | null} */
	let scaleMin = $state(null);
	/** @type {number | null} */
	let scaleMax = $state(null);
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
			{scaleMin}
			{scaleMax}
			ondomain={(d) => (domain = d)}
		/>
	{/if}
	<SiteSwitch sites={SITES} {active} onselect={(i) => (active = i)} />
	<ResolutionSwitch resolutions={RESOLUTIONS} active={resolution} onselect={(id) => (resolution = id)} />
	<ControlPanel>
		<!-- Always mounted: with no data loaded the scale row stays in place and
		     simply shows empty value boxes, so the panel never changes height. -->
		<Legend
			min={scaleMin ?? domain?.min ?? null}
			max={scaleMax ?? domain?.max ?? null}
			pinned={scaleMin != null || scaleMax != null}
			onmin={(v) => (scaleMin = v)}
			onmax={(v) => (scaleMax = v)}
			onreset={() => {
				scaleMin = null;
				scaleMax = null;
			}}
		/>
		<div class="row">
			<ClipShapeSwitch shapes={CLIP_SHAPES} active={clipShape} onselect={(id) => (clipShape = id)} />
			<div class="aside">
				<FilteredToggle active={showFiltered} onselect={(v) => (showFiltered = v)} />
			</div>
		</div>
	</ControlPanel>
</div>

<style>
	.stage {
		position: fixed;
		inset: 0;
	}

	.row {
		display: flex;
		align-items: stretch;
	}

	/* Hairline + breathing room so the toggle doesn't read as a fourth
	   button in the clip-shape group next to it. */
	.aside {
		display: flex;
		align-items: center;
		margin-left: auto;
		padding-left: 0.2rem;
		border-left: 1px solid #cdc1a9;
	}

	:global(body) {
		margin: 0;
		background: #f1ebdf;
	}
</style>
