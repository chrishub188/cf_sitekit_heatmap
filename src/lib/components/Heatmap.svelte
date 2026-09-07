<script>
	import { onDestroy } from 'svelte';
	import { createHeatmapData } from '$lib/data.js';
	import { interpolateRdYlBu } from 'd3';

	let {
		map, // maplibre Map instance (from SiteMap's onready)
		url, // prepared grid JSON (EPSG:4326) — see scripts/prepare-data.js
		center, // [lng, lat] centre of the radial clip — updates as the visitor's location changes
		radius = 50, // metres, radius of the clip circle around center
		beforeId = 'location-marker-halo', // insert below the location marker so it stays legible
		excludeNtzg = [20, 21, 30, 32],
		gap = 0.9, // fraction of the grid pitch each cell fills; the rest is gap
		roundness = 5, // superellipse exponent for cell corners; 2 = ellipse, higher = squarer
		opacity = 0.35
	} = $props();

	const SOURCE_ID = 'heatmap-cells';
	const LAYER_ID = 'heatmap-cells-fill';
	const FILTERED_COLOR = '#141414'; // faint ghost tint for excluded/invalid cells — no stroke, so the map stays visible
	const FILTERED_OPACITY = 0.025;

	// Fixed ends of the colour scale, in PET degrees. Deliberately hard-coded
	// rather than derived from the data: a scale fitted to whatever happens to
	// be inside the current clip circle makes the same cell change colour as
	// the visitor walks, so the same colour means a different temperature from
	// one moment to the next. Fixed ends make colours comparable across
	// positions and across sites. Readings outside the range are clamped to the
	// end colours. Change these two numbers to retune the scale.
	const PET_MIN = 32; // blue end
	const PET_MAX = 45; // red end
	const COLOR_STOPS = 11;

	const M_PER_DEG = 111320;

	// Recomputing the clip on every position update is what used to stall the
	// main thread — at ~5 Hz from an embedding host, permanently. The clip only
	// needs to keep up with walking, so it's rebuilt once the centre has
	// actually moved this far; standing still costs nothing at all.
	const MIN_CLIP_MOVE_M = 2;

	// Owns loading the prepared grid and selecting the cells inside the radial
	// clip — this component only applies the result to MapLibre.
	const heatmapData = createHeatmapData();

	// Colour lives in the paint property rather than in each feature, so the
	// cell geometry stays constant and can be cached across clip updates.
	// Sampled from d3's RdYlBu with the domain reversed, so high PET reads red.
	function colorByPet() {
		const stops = [];
		for (let i = 0; i < COLOR_STOPS; i++) {
			const t = i / (COLOR_STOPS - 1);
			stops.push(PET_MIN + (PET_MAX - PET_MIN) * t, interpolateRdYlBu(1 - t));
		}
		return [
			'case',
			['==', ['get', 'filtered'], true],
			FILTERED_COLOR,
			['interpolate', ['linear'], ['to-number', ['get', 'pet']], ...stops]
		];
	}

	function ensureLayer() {
		if (!map.getSource(SOURCE_ID)) {
			map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
		}
		if (!map.getLayer(LAYER_ID)) {
			const before = map.getLayer(beforeId) ? beforeId : undefined;
			map.addLayer(
				{
					id: LAYER_ID,
					type: 'fill',
					source: SOURCE_ID,
					paint: {
						'fill-color': colorByPet(),
						'fill-opacity': ['case', ['==', ['get', 'filtered'], true], FILTERED_OPACITY, opacity]
					}
				},
				before
			);
		}
	}

	/** @type {any} */
	let latest = null; // newest clip result, read by apply() so a deferred apply can't use stale data
	/** @type {[number, number] | null} */
	let builtFor = null; // centre `latest` was built for
	let builtUrl = null;
	let building = false;
	/** @type {{ center: [number, number], url: string } | null} */
	let queued = null; // newest request made while a build was in flight

	function movedEnough(from, to) {
		if (!from) return true;
		const dLng = (to[0] - from[0]) * M_PER_DEG * Math.cos((to[1] * Math.PI) / 180);
		const dLat = (to[1] - from[1]) * M_PER_DEG;
		return dLng * dLng + dLat * dLat >= MIN_CLIP_MOVE_M * MIN_CLIP_MOVE_M;
	}

	function apply() {
		ensureLayer();
		map.getSource(SOURCE_ID)?.setData(latest ?? { type: 'FeatureCollection', features: [] });
	}

	// One build at a time, and only the newest requested centre is ever queued —
	// otherwise a burst of position updates piles up builds that are already
	// obsolete by the time they run.
	async function build(target, targetUrl) {
		building = true;
		try {
			latest = await heatmapData.refresh(targetUrl, target, radius, {
				gap,
				roundness,
				excludeNtzg
			});
			builtFor = target;
			builtUrl = targetUrl;
			// isStyleLoaded() can flicker back to false later (e.g. while new tiles
			// stream in as the camera moves) — 'load' only ever fires once, so once
			// the layer exists we know the style loaded and can skip that flaky gate.
			if (map.getLayer(LAYER_ID) || map.isStyleLoaded()) apply();
			else map.once('load', apply);
		} finally {
			building = false;
			const next = queued;
			queued = null;
			if (next) build(next.center, next.url);
		}
	}

	// Applied from refresh()'s resolved value rather than the store's subscribe
	// — subscribe fires synchronously with whatever's already in the store, but
	// ensureLayer's beforeId lookup needs LocationMarker's layer to exist first.
	// The load is async even when the grid is already cached (refresh awaits a
	// promise), and LocationMarker's own layer-adding effect is synchronous, so
	// it always wins that race.
	$effect(() => {
		if (!map) return;
		const target = /** @type {[number, number]} */ (center);
		const targetUrl = url;
		// A different site is a hard rebuild — the movement gate doesn't apply.
		if (targetUrl !== builtUrl) {
			builtFor = null;
			queued = null;
		} else if (!movedEnough(builtFor, target)) return;

		if (building) queued = { center: target, url: targetUrl };
		else build(target, targetUrl);
	});

	onDestroy(() => {
		if (!map?.getStyle) return;
		if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
		if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
	});
</script>
