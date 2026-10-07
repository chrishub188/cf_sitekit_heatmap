<script module>
	// The layer a click or drag on a crown is tested against (see PlacementLayer).
	export const CROWN_HIT_LAYER = 'tree-crowns-fill';
</script>

<script>
	import { onDestroy } from 'svelte';
	import { shapeRing } from '$lib/geo.js';
	import { clipTest, loadPolygon } from '$lib/clip.js';
	import { CROWN_SHAPE, crownRadius } from '$lib/interventions.js';
	import { PLANTING_FILL, PLANTING_INK, zoom } from '$lib/style.js';

	let {
		map, // maplibre Map instance (from SiteMap's onready)
		// Tree placements — parsed from a log (see logfile.js) or dropped from the
		// palette. A dropped one has `manual: true` and an `id`.
		interventions = [],
		// The same four clip inputs the Heatmap gets, so crowns and cells appear
		// and disappear on exactly the same boundary.
		bounds,
		filterUrl,
		center,
		radius = 100,
		clipShape = 'square',
		visible = true, // false hides every layer without discarding the geometry
		filled = true, // false draws outlines only, so a heatmap underneath stays readable
		beforeId = 'site-marker', // above the heatmap's anchor, below the site chrome
		opacity = 0.55, // fill of a newly placed tree; an existing one gets EXISTING_SCALE of it
		dotRadius = 10, // px at z18; the ramp below keeps it proportional at other zooms
		dotOpacity = 0.0, // low enough that the crown, not the dot, is what you read first
		onshown // called with the number of crowns that survived the clip
	} = $props();

	const SOURCE_ID = 'tree-crowns';
	const LAYER_FILL = CROWN_HIT_LAYER;
	const LAYER_HALO = 'tree-crowns-halo';
	const LAYER_LINE = 'tree-crowns-line';
	const LAYER_DOT = 'tree-crowns-dot';
	const LAYERS = [LAYER_FILL, LAYER_HALO, LAYER_LINE, LAYER_DOT];
	const CROWN = ['==', ['get', 'kind'], 'crown'];
	const DOT = ['==', ['get', 'kind'], 'dot'];

	// The dot is a fixed pixel size, not metres — it has to stay visible once the
	// crown has shrunk away. One number drives all three stops so there's a single
	// knob to turn.
	const dotRamp = (/** @type {number} */ r) => zoom(14, r * 0.6, 18, r, 21, r * 1.4);

	// The crown's edge, and a paler halo just outside it that lifts the outline
	// off busy ground (the satellite imagery, a dense heatmap). The halo sits
	// entirely outside: twice the ink's width, offset outward by half of it.
	// CROWN_SHAPE runs clockwise, so outward is the line's left, a negative offset.
	const INK_WIDTH = [0.6, 1.4, 2.2]; // px at z14, z18, z21
	const ramp = (/** @type {number} */ k) => zoom(14, INK_WIDTH[0] * k, 18, INK_WIDTH[1] * k, 21, INK_WIDTH[2] * k);
	const HALO_OPACITY = 0.55;

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
	// each one is a few pixels across and half the outline's points go unseen.
	const COARSE_STEP = 2;
	const COARSE_ABOVE = 2000; // crowns

	// Two features per tree: the crown, the cloud outline at the type's real
	// radius, scaled with the map, and a fixed-pixel dot on its centre. The crown
	// shrinks to nothing when you zoom out, so the dot is what keeps a placement
	// findable — and it marks the exact coordinate, which the crown only implies.
	function toGeoJson(trees) {
		const step = trees.length > COARSE_ABOVE ? COARSE_STEP : 1;
		return {
			type: 'FeatureCollection',
			features: trees.flatMap((t) => {
				// The centre rides along so a press can pick the nearest of several
				// overlapping crowns rather than whichever is drawn on top.
				const properties = {
					type: t.type,
					new: t.isNew,
					manual: t.manual === true,
					id: t.id ?? null,
					lon: t.lon,
					lat: t.lat
				};
				return [
					{
						type: 'Feature',
						properties: { ...properties, kind: 'crown' },
						geometry: {
							type: 'Polygon',
							coordinates: [
								shapeRing(t.lon, t.lat, crownRadius(t.type), CROWN_SHAPE, t.orientation ?? 0, step)
							]
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

	const fillOpacity = () => byAge(filled ? opacity : 0);
	const visibility = () => (visible ? 'visible' : 'none');

	function ensureLayers() {
		if (!map.getSource(SOURCE_ID)) {
			map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
		}
		const before = map.getLayer(beforeId) ? beforeId : undefined;
		// Separate line layers, not fill-outline-color: that's a fixed hairline
		// that can't be weighted, and the crowns need a real edge. Every layer
		// covers every tree; new and existing differ only in the weight byAge()
		// gives them. The fill stays even at opacity 0, as the hit target.
		if (!map.getLayer(LAYER_FILL)) {
			map.addLayer(
				{
					id: LAYER_FILL,
					type: 'fill',
					source: SOURCE_ID,
					filter: CROWN,
					layout: { visibility: visibility() },
					paint: { 'fill-color': PLANTING_FILL, 'fill-opacity': fillOpacity() }
				},
				before
			);
		}
		if (!map.getLayer(LAYER_HALO)) {
			map.addLayer(
				{
					id: LAYER_HALO,
					type: 'line',
					source: SOURCE_ID,
					filter: CROWN,
					layout: { 'line-join': 'round', visibility: visibility() },
					paint: {
						'line-color': '#ffffff',
						'line-width': ramp(2),
						'line-offset': ramp(-1),
						'line-opacity': HALO_OPACITY
					}
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
					layout: { 'line-join': 'round', visibility: visibility() },
					paint: {
						'line-color': PLANTING_INK,
						'line-width': ramp(1),
						'line-opacity': byAge(1)
					}
				},
				before
			);
		}
		// Added last so it sits above the crown layers — a tree whose crown is
		// overlapped by a neighbour still shows where its own centre is.
		if (!map.getLayer(LAYER_DOT)) {
			map.addLayer(
				{
					id: LAYER_DOT,
					type: 'circle',
					source: SOURCE_ID,
					filter: DOT,
					layout: { visibility: visibility() },
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
		// the map: the bounds always belong to whichever site is on screen. Trees
		// placed by hand are exempt — one dropped just outside the Ø 50 m circle
		// would otherwise vanish the moment it lands.
		const inBounds = clipTest(currentClipShape, {
			bounds: currentBounds,
			polygonRings,
			center: currentCenter,
			radius: currentRadius
		});
		const kept = inBounds ? trees.filter((t) => t.manual || inBounds(t.lon, t.lat)) : trees;

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
		const fill = fillOpacity();
		if (!layersReady || !map.getLayer(LAYER_DOT)) return;
		map.setPaintProperty(LAYER_DOT, 'circle-radius', dotRamp(dotRadius));
		map.setPaintProperty(LAYER_DOT, 'circle-opacity', byAge(dotOpacity));
		if (map.getLayer(LAYER_FILL)) map.setPaintProperty(LAYER_FILL, 'fill-opacity', fill);
	});

	$effect(() => {
		const value = visibility();
		if (!layersReady) return;
		for (const id of LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', value);
	});

	onDestroy(() => {
		if (!map?.getStyle) return;
		for (const id of [...LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id);
		if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
	});
</script>
