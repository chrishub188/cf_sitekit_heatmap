<script>
	import SiteMap from '$lib/components/SiteMap.svelte';
	import SiteSwitch from '$lib/components/SiteSwitch.svelte';
	import ResolutionSwitch from '$lib/components/ResolutionSwitch.svelte';
	import HeatmapToggle from '$lib/components/HeatmapToggle.svelte';
	import FilteredToggle from '$lib/components/FilteredToggle.svelte';
	import SegmentedSwitch from '$lib/components/SegmentedSwitch.svelte';
	import ControlPanel from '$lib/components/ControlPanel.svelte';
	import Heatmap from '$lib/components/Heatmap.svelte';
	import TreeOverlay from '$lib/components/TreeOverlay.svelte';
	import PlanningOverlay from '$lib/components/PlanningOverlay.svelte';
	import PlanningPanel from '$lib/components/PlanningPanel.svelte';
	import LogDropZone from '$lib/components/LogDropZone.svelte';
	import LogRow from '$lib/components/LogRow.svelte';
	import Legend from '$lib/components/Legend.svelte';
	import AiWatermark from '$lib/components/AiWatermark.svelte';
	import RecenterButton from '$lib/components/RecenterButton.svelte';
	import { customStyle } from '$lib/style.js';
	import {
		SITES,
		RESOLUTIONS,
		CLIP_SHAPES,
		PHASES,
		RADIUS,
		SIMULATION_RADIUS,
		nearestSite
	} from '$lib/sites.js';
	import { parseLogfile, readLogFile } from '$lib/logfile.js';
	import { clipTest, loadPolygon } from '$lib/clip.js';
	import { gridToRows, requestEnvGrid } from '$lib/envgrid.js';
	import { loadLocalGrid } from '$lib/localgrid.js';
	import { customLayer, toLonLatFeatures } from '$lib/planning.js';

	let active = $state(0);
	let resolution = $state('1m');
	let showFiltered = $state(true);
	let clipShape = $state('circle');
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
	// The site's own 5 m model run (see localgrid.js), loaded only while 5 m is
	// on screen. Raw for the same reason as the baseline.
	/** @typedef {{ site: number, status: 'loading' | 'ready' | 'error', data: import('$lib/localgrid.js').GridRows | null, message: string | null }} LocalGridState */
	let localGrid = $state.raw(/** @type {LocalGridState | null} */ (null));
	/** @type {string | null} */
	let logError = $state(null);
	let mode = $state('heatmap');
	let phase = $state('after'); // 'before' | 'after' — which grid the heatmap draws for the log's site
	let shownTrees = $state(0); // crowns left after the active clip shape, reported by the overlay
	const interventions = $derived(log?.interventions ?? []);
	// Planning layers switched on. Ids carry the site folder, so each site keeps
	// its own selection across tab switches. Replaced, not mutated, on a toggle.
	let planning = $state(/** @type {Set<string>} */ (new Set()));
	// Dropped GeoJSON files, drawn by the planning overlay and listed in its
	// panel. Raw: the features are only ever replaced, never edited in place.
	let customLayers = $state.raw(/** @type {ReturnType<typeof customLayer>[]} */ ([]));
	let customCount = 0; // never reused, so a removed file's colour and id stay retired
	/** @type {string | null} */
	let customError = $state(null);
	let planningOpen = $state(false);
	// How far from a site's centre a dropped file may be and still switch to it.
	const CUSTOM_MATCH_M = 500;
	// Off hides the heatmap cells, leaving the planning areas (or the bare map).
	let showHeatmap = $state(true);

	/** @param {string} id @param {boolean} on */
	function togglePlanning(id, on) {
		const next = new Set(planning);
		if (on) next.add(id);
		else next.delete(id);
		planning = next;
	}

	const site = $derived(SITES[active]);
	// 5 m only exists where a site ships its own 5 m run. Elsewhere the button is
	// greyed out and the map falls back to 1 m, while `resolution` keeps the
	// choice for the next site that has one.
	const resolutionOptions = $derived(
		RESOLUTIONS.map((r) =>
			r.source === 'local' && !site.grid5mUrl
				? { ...r, disabled: true, title: 'Not modelled at 5 m for this site' }
				: r
		)
	);
	const shownResolution = $derived(
		resolutionOptions.find((r) => r.id === resolution && !r.disabled) ??
			resolutionOptions.find((r) => !r.disabled) ??
			resolutionOptions[0]
	);
	const local = $derived(shownResolution.source === 'local');
	// The plaza outline's own extent, so the camera frames the polygon rather
	// than the 100 m box around the site centre, which it can be off-centre from.
	let plazaBounds = $state(/** @type {{ url: string, bounds: number[] } | null} */ (null));
	$effect(() => {
		const url = site.filterUrl;
		if (clipShape !== 'plaza' || !url || plazaBounds?.url === url) return;
		loadPolygon(url).then((rings) => {
			if (!rings) return;
			const xs = rings[0].map((p) => p[0]);
			const ys = rings[0].map((p) => p[1]);
			plazaBounds = { url, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
		});
	});
	// The 'full' shape swaps in the wider rect for both the clip and the camera,
	// 'plaza' frames its polygon once loaded; circle keeps the 100 m framing.
	const viewBounds = $derived(
		clipShape === 'full'
			? site.fullBounds
			: clipShape === 'plaza' && plazaBounds?.url === site.filterUrl
				? plazaBounds.bounds
				: site.bounds
	);
	// Only the log's own site swaps in the recalculated grid; the other tabs, and
	// this one until the backend answers, keep showing the baseline.
	const simulated = $derived(
		log?.site === active && simulation?.status === 'ready' ? simulation.grid : null
	);
	const baseGrid = $derived(
		baseline?.site === active && baseline.status === 'ready' ? baseline.grid : null
	);
	const grid = $derived(phase === 'after' && simulated ? simulated : baseGrid);
	const localCells = $derived(
		localGrid?.site === active && localGrid.status === 'ready' ? localGrid.data : null
	);
	// 5 m draws the site's own model run as it is; 1 m draws the backend grid.
	const cells = $derived(
		local ? localCells : grid ? gridToRows(grid, shownResolution.size) : null
	);
	// What the legend reports while the grid on screen isn't there yet.
	const heatStatus = $derived(
		local ? (localCells ? null : (localGrid?.status ?? null)) : grid ? null : (baseline?.status ?? null)
	);
	const heatMessage = $derived(local ? (localGrid?.message ?? null) : (baseline?.message ?? null));
	// Before/After only means something on the log's own site, once a rerun has
	// been requested; 'After' stays greyed out until the backend answers.
	const comparable = $derived(mode === 'heatmap' && log?.site === active && simulation != null);
	// Trees are only ever rerun at 1 m, so at 5 m there is no modelled 'After'
	// to show — only the 5 m baseline.
	const phaseOptions = $derived(
		PHASES.map((p) =>
			p.id !== 'after'
				? p
				: local
					? { ...p, disabled: true, title: 'Tree reruns are only simulated at 1 m' }
					: !simulated
						? { ...p, disabled: true, title: simulation?.message ?? 'Simulating…' }
						: p
		)
	);

	// Loads the site's 5 m run while 5 m is on screen.
	$effect(() => {
		if (!local || !site.grid5mUrl) return;
		const index = active;
		let current = true;
		localGrid = { site: index, status: 'loading', data: null, message: null };
		loadLocalGrid(site.grid5mUrl)
			.then((data) => {
				if (current) localGrid = { site: index, status: 'ready', data, message: null };
			})
			.catch((err) => {
				if (!current) return;
				console.warn('5 m grid failed', err);
				const message = err instanceof Error ? err.message : String(err);
				localGrid = { site: index, status: 'error', data: null, message };
			});
		return () => {
			current = false;
		};
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

	const GEOJSON_TYPES = new Set([
		'FeatureCollection', 'Feature', 'Point', 'MultiPoint', 'LineString',
		'MultiLineString', 'Polygon', 'MultiPolygon'
	]);

	// A dropped file is GeoJSON if it says so by extension, or if it parses as
	// JSON with a GeoJSON `type`. Logfiles are pseudo-JSON and never parse, so
	// they fall through to the log parser untouched.
	/** @param {string} name @param {string} text @returns {any} the parsed object, or null for a logfile */
	function asGeoJson(name, text) {
		const byName = /\.geojson$/i.test(name);
		try {
			const json = JSON.parse(text);
			if (GEOJSON_TYPES.has(json?.type)) return json;
		} catch (err) {
			if (byName) throw new Error(`${name} is not valid JSON`);
			return null;
		}
		if (byName) throw new Error(`${name} has no GeoJSON type`);
		return null;
	}

	/** @param {string} name @param {any} geojson */
	function addCustomLayer(name, geojson) {
		const features = toLonLatFeatures(geojson);
		if (features.length === 0) throw new Error(`No geometries found in ${name}`);
		const layer = customLayer(name, features, customCount++);
		customLayers = [...customLayers, layer];
		togglePlanning(layer.id, true);
		customError = null;
		planningOpen = true;
		// Like a logfile, a file at one of the sites brings that site on screen;
		// one elsewhere is kept, but the camera stays where it is.
		const match = nearestSite(roughCenter(features), CUSTOM_MATCH_M);
		if (match) active = match.index;
	}

	// Midpoint of the features' extent — enough to tell which site they're at.
	/** @param {any[]} features @returns {number[]} */
	function roughCenter(features) {
		let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
		/** @param {any} c */
		const walk = (c) => {
			if (typeof c[0] !== 'number') return c.forEach(walk);
			w = Math.min(w, c[0]);
			e = Math.max(e, c[0]);
			s = Math.min(s, c[1]);
			n = Math.max(n, c[1]);
		};
		for (const f of features) walk(f.geometry.coordinates);
		return [(w + e) / 2, (s + n) / 2];
	}

	/** @param {string} id */
	function removeCustomLayer(id) {
		customLayers = customLayers.filter((l) => l.id !== id);
		togglePlanning(id, false);
	}

	// From the panel's import button: GeoJSON only, so anything else is an error
	// there rather than being tried as a logfile.
	/** @param {File} file */
	async function importGeoJson(file) {
		try {
			const { name, text } = await readLogFile(file);
			const geojson = asGeoJson(name, text);
			if (!geojson) throw new Error(`${name} is not GeoJSON`);
			addCustomLayer(name, geojson);
		} catch (err) {
			customError = err instanceof Error ? err.message : String(err);
			planningOpen = true;
		}
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

		try {
			const geojson = asGeoJson(name, text);
			if (geojson) {
				addCustomLayer(name, geojson);
				return;
			}
		} catch (err) {
			customError = err instanceof Error ? err.message : String(err);
			planningOpen = true;
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
		phase = 'after';
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
			visible={mode === 'heatmap' && showHeatmap}
			ondomain={(d) => (domain = d)}
		/>
		<PlanningOverlay {map} {site} enabled={planning} custom={customLayers} />
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
	<div class="top-right">
		<HeatmapToggle active={showHeatmap} onselect={(v) => (showHeatmap = v)} />
		<ResolutionSwitch
			resolutions={resolutionOptions}
			active={shownResolution.id}
			onselect={(id) => (resolution = id)}
		/>
	</div>
	<div class="top">
		{#if comparable}
			<div class="chip">
				<SegmentedSwitch
					options={phaseOptions}
					active={simulated && !local ? phase : 'before'}
					onselect={(id) => (phase = id)}
				/>
			</div>
		{/if}
		{#if map}
			<RecenterButton {map} bounds={viewBounds} bearing={site.bearing} />
		{/if}
	</div>
	<div class="corner">
		<PlanningPanel
			{site}
			enabled={planning}
			custom={customLayers}
			error={customError}
			bind:open={planningOpen}
			ontoggle={togglePlanning}
			onremove={removeCustomLayer}
			onfile={importGeoJson}
		/>
		<ControlPanel>
			<!-- Always mounted: with no data loaded the scale row stays in place and
			     simply shows empty value boxes, so the panel never changes height. -->
			<Legend
				min={scaleMin ?? domain?.min ?? null}
				max={scaleMax ?? domain?.max ?? null}
				pinned={scaleMin != null || scaleMax != null}
				status={heatStatus}
				statusMessage={heatMessage}
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

	/* Bottom-left stack: planning areas above the control panel. Both boxes
	   stretch to the widest one so the corner reads as one column. */
	.corner {
		position: absolute;
		bottom: 1rem;
		left: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		width: fit-content;
	}

	/* Top right: heatmap on/off next to the resolution it's drawn at. */
	.top-right {
		position: absolute;
		top: 1rem;
		right: 1rem;
		display: flex;
		gap: 0.4rem;
	}

	/* Top centre, between the site tabs and the resolution switch. */
	.top {
		position: absolute;
		top: 1rem;
		left: 50%;
		display: flex;
		gap: 0.4rem;
		transform: translateX(-50%);
	}

	/* Same framing as the resolution switch, around the shared segmented switch. */
	.chip {
		padding: 1px;
		border: 1px solid #cdc1a9;
		border-radius: 999px;
		background: #cdc1a9;
	}

	/* Rounded inside the 1px ring too, so the end buttons don't show square corners. */
	.chip :global(nav) {
		overflow: hidden;
		border-radius: 999px;
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
