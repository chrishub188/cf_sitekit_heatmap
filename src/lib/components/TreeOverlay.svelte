<script>
	import { onDestroy } from 'svelte';
	import { circleRing } from '$lib/geo.js';
	import { clipTest, loadPolygon } from '$lib/clip.js';
	import { CROWN_RADIUS_M } from '$lib/logfile.js';
	import { PLANTING_FILL, PLANTING_INK, zoom } from '$lib/style.js';

	let {
		map, // maplibre Map instance (from SiteMap's onready)
		interventions = [], // parsed tree placements — see logfile.js
		// The same four clip inputs the Heatmap gets, so crowns and cells appear
		// and disappear on exactly the same boundary.
		bounds,
		filterUrl,
		center,
		radius = 100,
		clipShape = 'square',
		visible = true, // false hides both layers without discarding the geometry
		beforeId = 'site-marker', // above the heatmap's anchor, below the site chrome
		// Vertices per crown. 36 keeps the chord error near 2 cm — under half a
		// pixel even at z21, where the app's default framing never goes but a
		// manual zoom can. Cheap at these counts; see COARSE_ABOVE for bulk logs.
		segments = 36,
		opacity = 0.55, // fill of a newly placed tree; an existing one gets EXISTING_SCALE of it
		dotRadius = 10, // px at z18; the ramp below keeps it proportional at other zooms
		dotOpacity = 0.0, // low enough that the crown, not the dot, is what you read first
		onshown // called with the number of crowns that survived the clip
	} = $props();

	const SOURCE_ID = 'tree-crowns';
	const LAYER_FILL = 'tree-crowns-fill';
	const LAYER_LINE = 'tree-crowns-line';
	const LAYER_DOT = 'tree-crowns-dot';
	const CROWN = ['==', ['get', 'kind'], 'crown'];
	const DOT = ['==', ['get', 'kind'], 'dot'];

	// The dot is a fixed pixel size, not metres — it has to stay visible once the
	// crown has shrunk away. One number drives all three stops so there's a single
	// knob to turn.
	const dotRamp = (/** @type {number} */ r) => zoom(14, r * 0.6, 18, r, 21, r * 1.4);

	// Every crown is filled — a canopy should read as a canopy, not as an
	// annotation. New and existing are then separated by weight rather than by
	// presence: a proposed tree sits a little denser, its edge a little firmer.
	const EXISTING_SCALE = 0.6;
	const byAge = (/** @type {number} */ forNew) => [
		'case',
		['==', ['get', 'new'], true],
		forNew,
		forNew * EXISTING_SCALE
	];
	// Crowns are only ever this dense in a log covering a whole quarter, where
	// each one is a few pixels across and the corners cost vertices nobody sees.
	const COARSE_SEGMENTS = 10;
	const COARSE_ABOVE = 2000; // crowns

	// Two features per tree: the crown, a real 6 m circle that scales with the
	// map, and a fixed-pixel dot on its centre. The crown shrinks to nothing when
	// you zoom out, so the dot is what keeps a placement findable — and it marks
	// the exact coordinate the log recorded, which the crown only implies.
	function toGeoJson(trees) {
		const sides = trees.length > COARSE_ABOVE ? COARSE_SEGMENTS : segments;
		return {
			type: 'FeatureCollection',
			features: trees.flatMap((t) => {
				const properties = { type: t.type, new: t.isNew };
				return [
					{
						type: 'Feature',
						properties: { ...properties, kind: 'crown' },
						geometry: {
							type: 'Polygon',
							coordinates: [circleRing(t.lon, t.lat, CROWN_RADIUS_M, sides)]
						}
					},
					{
						type: 'Feature',
						properties: { ...properties, kind: 'dot' },
						geometry: { type: 'Point', coordinates: [t.lon, t.lat] }
					}
				];
			})
		};
	}

	function ensureLayers() {
		if (!map.getSource(SOURCE_ID)) {
			map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
		}
		const before = map.getLayer(beforeId) ? beforeId : undefined;
		// Two layers, not one: fill-outline-color is a fixed hairline that can't be
		// weighted, and the crowns need a real edge. Both cover every tree; new and
		// existing differ only in the weight byAge() gives them.
		if (!map.getLayer(LAYER_FILL)) {
			map.addLayer(
				{
					id: LAYER_FILL,
					type: 'fill',
					source: SOURCE_ID,
					filter: CROWN,
					layout: { visibility: visible ? 'visible' : 'none' },
					paint: { 'fill-color': PLANTING_FILL, 'fill-opacity': byAge(opacity) }
				},
				before
			);
		}
		if (!map.getLayer(LAYER_LINE)) {
			map.addLayer(
				{
					id: LAYER_LINE,
					type: 'line',
					source: SOURCE_ID,
					filter: CROWN,
					layout: { 'line-join': 'round', visibility: visible ? 'visible' : 'none' },
					paint: {
						'line-color': PLANTING_INK,
						'line-width': zoom(14, 0.5, 18, 1.1, 21, 2.2),
						'line-opacity': byAge(1)
					}
				},
				before
			);
		}
		// Added last so it sits above both crown layers — a tree whose crown is
		// overlapped by a neighbour still shows where its own centre is.
		if (!map.getLayer(LAYER_DOT)) {
			map.addLayer(
				{
					id: LAYER_DOT,
					type: 'circle',
					source: SOURCE_ID,
					filter: DOT,
					layout: { visibility: visible ? 'visible' : 'none' },
					// No halo: a paper ring would read as a separate marker competing
					// with the site chrome. Over a new tree's own fill the dot still
					// darkens enough to see.
					paint: {
						'circle-radius': dotRamp(dotRadius),
						'circle-color': PLANTING_INK,
						'circle-opacity': byAge(dotOpacity)
					}
				},
				before
			);
		}
		layersReady = true;
	}

	function setData(geojson) {
		map.getSource(SOURCE_ID)?.setData(geojson ?? { type: 'FeatureCollection', features: [] });
	}

	// Same memoised style gate as the Heatmap: `isStyleLoaded()` goes false again
	// whenever a source is still settling, while 'load' only ever fires once, so
	// a per-call test can attach to an event that has already passed and drop the
	// update for good. 'idle' is the backstop, since it fires after every settle.
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

	// Only the newest build may touch the map: the 'plaza' shape fetches a polygon
	// the others don't, so an earlier, slower pass could otherwise land last.
	let generation = 0;
	let layersReady = $state(false);

	async function build(trees, currentClipShape, currentFilterUrl, currentBounds, currentCenter, currentRadius) {
		if (!map) return;
		const token = ++generation;
		const polygonRings =
			currentClipShape === 'plaza' && currentFilterUrl ? await loadPolygon(currentFilterUrl) : null;
		if (token !== generation) return;

		// Clipping to the active site is also what keeps another site's trees off
		// the map: the bounds always belong to whichever site is on screen.
		const inBounds = clipTest(currentClipShape, {
			bounds: currentBounds,
			polygonRings,
			center: currentCenter,
			radius: currentRadius
		});
		const kept = inBounds ? trees.filter((t) => inBounds(t.lon, t.lat)) : trees;

		await mapReady();
		if (token !== generation) return; // superseded while we were fetching
		ensureLayers();
		setData(toGeoJson(kept));
		onshown?.(kept.length);
	}

	// Every clip input is read here, synchronously, so each one is tracked.
	$effect(() => {
		build(interventions, clipShape, filterUrl, bounds, center, radius);
	});

	$effect(() => {
		if (!layersReady || !map.getLayer(LAYER_DOT)) return;
		map.setPaintProperty(LAYER_DOT, 'circle-radius', dotRamp(dotRadius));
		map.setPaintProperty(LAYER_DOT, 'circle-opacity', byAge(dotOpacity));
		if (map.getLayer(LAYER_FILL)) map.setPaintProperty(LAYER_FILL, 'fill-opacity', byAge(opacity));
	});

	$effect(() => {
		if (!layersReady) return;
		for (const id of [LAYER_FILL, LAYER_LINE, LAYER_DOT]) {
			if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
		}
	});

	onDestroy(() => {
		if (!map?.getStyle) return;
		for (const id of [LAYER_DOT, LAYER_LINE, LAYER_FILL]) if (map.getLayer(id)) map.removeLayer(id);
		if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
	});
</script>
