<script>
	import SiteMap from '$lib/components/SiteMap.svelte';
	import SiteSwitch from '$lib/components/SiteSwitch.svelte';
	import ResolutionSwitch from '$lib/components/ResolutionSwitch.svelte';
	import FilteredToggle from '$lib/components/FilteredToggle.svelte';
	import SegmentedSwitch from '$lib/components/SegmentedSwitch.svelte';
	import ControlPanel from '$lib/components/ControlPanel.svelte';
	import Heatmap from '$lib/components/Heatmap.svelte';
	import TreeOverlay from '$lib/components/TreeOverlay.svelte';
	import LogDropZone from '$lib/components/LogDropZone.svelte';
	import LogRow from '$lib/components/LogRow.svelte';
	import Legend from '$lib/components/Legend.svelte';
	import { customStyle } from '$lib/style.js';
	import { SITES, RESOLUTIONS, CLIP_SHAPES, RADIUS, nearestSite } from '$lib/sites.js';
	import { parseLogfile, readLogFile } from '$lib/logfile.js';

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
	// A dropped logfile of tree placements. The camera never follows it: a log is
	// adopted by the nearest of the three sites, or rejected, so the map only
	// ever frames a site we have data for.
	let log = $state(
		/** @type {({ name: string } & import('$lib/logfile.js').ParsedLog) | null} */ (null)
	);
	/** @type {string | null} */
	let logError = $state(null);
	let mode = $state('heatmap');
	let shownTrees = $state(0); // crowns left after the active clip shape, reported by the overlay
	const interventions = $derived(log?.interventions ?? []);

	const site = $derived(SITES[active]);
	const crs = $derived(RESOLUTIONS.find((r) => r.id === resolution).crs);
	// The 'full' shape swaps in the wider rect for both the clip and the camera;
	// plaza and circle keep the 100 m framing they already assume.
	const viewBounds = $derived(clipShape === 'full' ? site.fullBounds : site.bounds);

	// One place to land in: a rejected file never leaves a half-loaded log behind.
	function reportError(message) {
		log = null;
		logError = message;
	}

	/** @param {File} file */
	async function loadFile(file) {
		let name, text;
		try {
			({ name, text } = await readLogFile(file));
		} catch (err) {
			reportError(err.message);
			return;
		}

		const parsed = parseLogfile(text);
		if (parsed.interventions.length === 0) {
			reportError(`No tree placements found in ${name}`);
			return;
		}

		// The first entry carrying a centre fixes the log's location: deterministic
		// and in log order, where a centroid of several centres could land between
		// two sites and match neither.
		const located = parsed.entries.find((e) => e.center);
		const match = located?.center ? nearestSite(located.center) : null;
		if (!match) {
			// Every tree would fail the clip test anyway, so say so rather than
			// switching tabs and drawing an empty map.
			reportError(`${name} is not near a known site`);
			return;
		}

		logError = null;
		log = { name, ...parsed };
		// Start at the full count so the row never briefly shows the previous
		// log's "n of m" before the overlay reports back.
		shownTrees = parsed.interventions.length;
		active = match.index;
		mode = 'trees';
	}

	function clearLog() {
		log = null;
		logError = null;
		mode = 'heatmap';
	}
</script>

<svelte:head>
	<title>Site plans</title>
</svelte:head>

<div class="stage">
	<SiteMap
		mapStyle={customStyle}
		bounds={viewBounds}
		bearing={site.bearing}
		onready={(m) => (map = m)}
	/>
	{#if map}
		<Heatmap
			{map}
			url={site.data[resolution]}
			{crs}
			bounds={viewBounds}
			filterUrl={site.filterUrl}
			center={site.center}
			radius={RADIUS}
			{clipShape}
			{showFiltered}
			{scaleMin}
			{scaleMax}
			visible={mode === 'heatmap'}
			ondomain={(d) => (domain = d)}
		/>
		{#if interventions.length}
			<TreeOverlay
				{map}
				{interventions}
				bounds={viewBounds}
				filterUrl={site.filterUrl}
				center={site.center}
				radius={RADIUS}
				{clipShape}
				visible={mode === 'trees'}
				onshown={(n) => (shownTrees = n)}
			/>
		{/if}
	{/if}
	<LogDropZone onfile={loadFile} onerror={reportError} />
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
			<SegmentedSwitch options={CLIP_SHAPES} active={clipShape} onselect={(id) => (clipShape = id)} />
			<div class="aside">
				<FilteredToggle active={showFiltered} onselect={(v) => (showFiltered = v)} />
			</div>
		</div>
		<LogRow
			name={log?.name ?? null}
			count={interventions.length}
			shown={shownTrees}
			entries={log?.entries.length ?? 0}
			error={logError}
			{mode}
			onmode={(m) => (mode = m)}
			onfile={loadFile}
			onclear={clearLog}
		/>
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
