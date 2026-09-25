<script>
	import { onDestroy } from 'svelte';
	import { planningLayers, loadPlanningLayer } from '$lib/planning.js';

	let {
		map, // maplibre Map instance (from SiteMap's onready)
		site, // the site on screen; its `planning` field lists the files
		enabled = new Set(), // ids of the layers switched on (see planningLayers)
		beforeId = 'planning-anchor' // above the heatmap, below the tree crowns
	} = $props();

	// Deliberately independent of the heatmap: no clip shape, no mode. The areas
	// are drawn as they are, over whatever the map is showing.
	const SOURCE_ID = 'planning-areas';
	const LAYER_FILL = 'planning-fill';
	const LAYER_LINE = 'planning-line';
	const LAYER_BOUNDARY = 'planning-boundary';
	const LAYERS = [LAYER_FILL, LAYER_LINE, LAYER_BOUNDARY];
	const EMPTY = { type: 'FeatureCollection', features: [] };

	// Widths are per layer in px at z18, scaled with zoom like the other overlays.
	const width = ['get', 'lineWidth'];
	const lineWidth = [
		'interpolate', ['linear'], ['zoom'],
		14, ['*', width, 0.5],
		18, width,
		21, ['*', width, 1.6]
	];

	function ensureLayers() {
		if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY });
		const before = map.getLayer(beforeId) ? beforeId : undefined;
		if (!map.getLayer(LAYER_FILL)) {
			map.addLayer(
				{
					id: LAYER_FILL,
					type: 'fill',
					source: SOURCE_ID,
					filter: ['>', ['get', 'fillOpacity'], 0],
					paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] }
				},
				before
			);
		}
		// Two line layers because line-dasharray can't be data-driven: solid
		// edges for the restrictions and the design area, dashes for the boundary.
		if (!map.getLayer(LAYER_LINE)) {
			map.addLayer(
				{
					id: LAYER_LINE,
					type: 'line',
					source: SOURCE_ID,
					filter: ['!', ['get', 'dashed']],
					layout: { 'line-join': 'round' },
					paint: { 'line-color': ['get', 'color'], 'line-width': lineWidth, 'line-opacity': 0.9 }
				},
				before
			);
		}
		if (!map.getLayer(LAYER_BOUNDARY)) {
			map.addLayer(
				{
					id: LAYER_BOUNDARY,
					type: 'line',
					source: SOURCE_ID,
					filter: ['get', 'dashed'],
					layout: { 'line-join': 'round' },
					paint: { 'line-color': ['get', 'color'], 'line-width': lineWidth, 'line-dasharray': [4, 2.5] }
				},
				before
			);
		}
	}

	// Same memoised style gate as the Heatmap and TreeOverlay.
	/** @type {Promise<void> | null} */
	let readyGate = null;

	function mapReady() {
		readyGate ??= map.isStyleLoaded()
			? Promise.resolve()
			: new Promise((resolve) => {
					map.once('load', resolve);
					map.once('idle', resolve);
				});
		return readyGate;
	}

	// Only the newest build may touch the map: a slow fetch from before a site
	// switch must not land on top of the current site's layers.
	let generation = 0;

	/** @param {Parameters<typeof planningLayers>[0]} currentSite @param {Set<string>} currentEnabled */
	async function build(currentSite, currentEnabled) {
		if (!map) return;
		const token = ++generation;
		// Already in stacking order, so the 00 boundary ends up at the bottom and
		// the design area on top.
		const layers = planningLayers(currentSite).filter((l) => currentEnabled.has(l.id));
		const loaded = await Promise.all(layers.map((l) => loadPlanningLayer(l.url)));
		if (token !== generation) return;

		const features = layers.flatMap(({ id, color, fillOpacity, lineWidth, dashed }, i) =>
			(loaded[i] ?? []).map((f) => ({
				...f,
				properties: { layer: id, color, fillOpacity, lineWidth, dashed }
			}))
		);

		await mapReady();
		if (token !== generation) return;
		ensureLayers();
		map.getSource(SOURCE_ID)?.setData({ type: 'FeatureCollection', features });
	}

	$effect(() => {
		build(site, enabled);
	});

	onDestroy(() => {
		if (!map?.getStyle) return;
		for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
		if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
	});
</script>
