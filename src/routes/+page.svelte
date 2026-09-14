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
	import AiWatermark from '$lib/components/AiWatermark.svelte';
	import { customStyle } from '$lib/style.js';
	import { SITES, RESOLUTIONS, CLIP_SHAPES, RADIUS, SIMULATION_RADIUS, nearestSite } from '$lib/sites.js';
	import { parseLogfile, readLogFile } from '$lib/logfile.js';
	import { clipTest } from '$lib/clip.js';
	import { gridToRows, requestEnvGrid } from '$lib/envgrid.js';

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
		/** @type {({ name: string, site: number } & import('$lib/logfile.js').ParsedLog) | null} */ (null)
	);
	/** @typedef {{ status: 'loading' | 'ready' | 'error', grid: import('$lib/envgrid.js').EnvGrid | null, message: string | null }} GridState */
	// The site on screen's baseline grid, fetched from the backend. Raw state: a
	// 300 m grid is 90k values, far too many to wrap in reactive proxies.
	let baseline = $state.raw(/** @type {(GridState & { site: number }) | null} */ (null));
	// The log's site rerun with its trees in place.
	let simulation = $state.raw(/** @type {GridState | null} */ (null));
	/** @type {string | null} */
	let logError = $state(null);
	let mode = $state('heatmap');
	let shownTrees = $state(0); // crowns left after the active clip shape, reported by the overlay
	const interventions = $derived(log?.interventions ?? []);

	const site = $derived(SITES[active]);
	const cellSize = $derived(RESOLUTIONS.find((r) => r.id === resolution).size);
	// The 'full' shape swaps in the wider rect for both the clip and the camera;
	// plaza and circle keep the 100 m framing they already assume.
	const viewBounds = $derived(clipShape === 'full' ? site.fullBounds : site.bounds);
	// Only the log's own site swaps in the recalculated grid; the other tabs, and
	// this one until the backend answers, keep showing the baseline.
	const simulated = $derived(
		log?.site === active && simulation?.status === 'ready' ? simulation.grid : null
	);
	const baseGrid = $derived(
		baseline?.site === active && baseline.status === 'ready' ? baseline.grid : null
	);
	const cells = $derived.by(() => {
		const grid = simulated ?? baseGrid;
		return grid ? gridToRows(grid, cellSize) : null;
	});

	// Each backend call opens a new session and takes seconds, so a site's
	// baseline is fetched once per page load and reused on every revisit. A
	// failed request is dropped from the cache, so coming back to the tab retries.
	/** @type {Map<string, Promise<import('$lib/envgrid.js').EnvGrid>>} */
	const baselineCache = new Map();

	/** @param {(typeof SITES)[number]} s */
	function fetchBaseline(s) {
		let pending = baselineCache.get(s.id);
		if (!pending) {
			pending = requestEnvGrid({
				center: [s.center[0], s.center[1]],
				radius: SIMULATION_RADIUS,
				gridType: 'PET',
				interventions: []
			});
			pending.catch(() => baselineCache.delete(s.id));
			baselineCache.set(s.id, pending);
		}
		return pending;
	}

	// Not aborted on a tab switch: the answer still lands in the cache, ready
	// for when the user comes back.
	$effect(() => {
		const index = active;
		let current = true;
		baseline = { site: index, status: 'loading', grid: null, message: null };
		fetchBaseline(SITES[index])
			.then((grid) => {
				if (current) baseline = { site: index, status: 'ready', grid, message: null };
			})
			.catch((err) => {
				if (!current) return;
				console.warn('baseline grid failed', err);
				const message = err instanceof Error ? err.message : String(err);
				baseline = { site: index, status: 'error', grid: null, message };
			});
		return () => {
			current = false;
		};
	});

	// One request per loaded log, cancelled if the log is cleared or replaced
	// before the backend answers.
	$effect(() => {
		if (!log) {
			simulation = null;
			return;
		}
		const logSite = SITES[log.site];
		// The grid spans the full crop, so only trees inside it can affect it.
		const inGrid = clipTest('full', { bounds: logSite.fullBounds });
		const trees = log.interventions.filter((t) => !inGrid || inGrid(t.lon, t.lat));
		if (trees.length === 0) {
			simulation = null;
			return;
		}

		const controller = new AbortController();
		simulation = { status: 'loading', grid: null, message: null };
		requestEnvGrid(
			{
				center: [logSite.center[0], logSite.center[1]],
				radius: SIMULATION_RADIUS,
				gridType: 'PET',
				interventions: trees.map(({ type, lat, lon, isNew }) => ({ type, lat, lon, isNew }))
			},
			controller.signal
		)
			.then((grid) => {
				simulation = { status: 'ready', grid, message: null };
			})
			.catch((err) => {
				if (controller.signal.aborted) return;
				console.warn('simulation failed', err);
				simulation = { status: 'error', grid: null, message: err instanceof Error ? err.message : String(err) };
			});
		return () => controller.abort();
	});

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
		log = { name, site: match.index, ...parsed };
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
			rows={cells?.rows ?? null}
			pitch={cells?.pitch ?? 1}
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
	<AiWatermark />
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
			status={simulated || baseline?.status === 'ready' ? null : (baseline?.status ?? null)}
			statusMessage={baseline?.message ?? null}
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
			simulation={log?.site === active ? (simulation?.status ?? null) : null}
			simulationError={simulation?.message ?? null}
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
