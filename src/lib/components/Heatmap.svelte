<script>
	import { onDestroy } from 'svelte';
	import { createHeatmapData } from '$lib/data.js';

	let {
		map, // maplibre Map instance (from SiteMap's onready)
		url, // CSV with x,y,pet|value,(ntzg) columns, x/y in UTM32N metres (EPSG:25832)
		pitch = 1, // grid spacing in metres, used to derive cell size
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
	const FILTERED_OPACITY = 0.025;

	// Owns fetching/parsing/reprojecting the CSV and rebuilding the radial-clip
	// GeoJSON — this component only applies the result to MapLibre.
	const heatmapData = createHeatmapData();

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
						'fill-color': ['get', 'color'],
						'fill-opacity': ['case', ['==', ['get', 'filtered'], true], FILTERED_OPACITY, opacity]
					}
				},
				before
			);
		}
	}

	function setMapData(geojson) {
		map.getSource(SOURCE_ID)?.setData(geojson ?? { type: 'FeatureCollection', features: [] });
	}

	// Applied from refresh()'s resolved value rather than the store's subscribe
	// — subscribe fires synchronously with whatever's already in the store, but
	// ensureLayer's beforeId lookup needs LocationMarker's layer to exist first,
	// and only the genuine async gap of the CSV fetch guarantees that (Location-
	// Marker's own layer-adding effect is synchronous, so it always wins the race).
	$effect(() => {
		if (!map) return;
		let cancelled = false;
		heatmapData.refresh(url, center, radius, { pitch, gap, roundness, excludeNtzg }).then((geojson) => {
			if (cancelled) return;
			const apply = () => {
				ensureLayer();
				setMapData(geojson);
			};
			// isStyleLoaded() can flicker back to false later (e.g. while new tiles
			// stream in as the camera moves) — 'load' only ever fires once, so once
			// the layer exists we know the style loaded and can skip that flaky gate.
			if (map.getLayer(LAYER_ID) || map.isStyleLoaded()) apply();
			else map.once('load', apply);
		});
		return () => {
			cancelled = true;
		};
	});

	onDestroy(() => {
		if (!map?.getStyle) return;
		if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
		if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
	});
</script>
