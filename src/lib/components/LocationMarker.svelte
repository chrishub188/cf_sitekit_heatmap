<script>
	import { onDestroy } from 'svelte';

	let {
		map, // maplibre Map instance (from SiteMap's onready)
		location, // { lng, lat } (EPSG:4326) — no marker drawn until this arrives
		heading = null, // degrees clockwise from true north; null = no direction wedge, dot only
		beforeId = 'street-label', // insert below street labels, same stacking as the old static style layers
		color = '#9A9081', // INK, matches style.js's site plan ink
		haloColor = color,
		strokeColor = '#F1EBDF' // PAPER, matches style.js's paper ground
	} = $props();

	// Two sources rather than one, because the two inputs update at completely
	// different rates: position changes at walking pace, heading changes every
	// time the visitor turns their head. Sharing a source meant every heading
	// tick also re-uploaded the dot and halo, and every position tick re-built
	// the wedge — with a host feed at ~5 Hz that is a lot of pointless traffic
	// through MapLibre's worker. Split, a turn touches only the wedge.
	const POINT_SOURCE_ID = 'location-marker';
	const WEDGE_SOURCE_ID = 'location-marker-wedge';
	const HALO_LAYER_ID = 'location-marker-halo';
	const HEADING_LAYER_ID = 'location-marker-heading';
	const DOT_LAYER_ID = 'location-marker-dot';

	const M_PER_DEG = 111320;

	// Soft "flashlight beam" wedge pointing at `heading`, built from concentric
	// annular bands whose opacity fades with distance from the marker (closest =
	// most intense) — MapLibre fill layers can't express a true radial gradient,
	// so this approximates one with stepped bands. The innermost band already
	// has width at its base (nonzero inner radius) rather than converging to a
	// sharp point, so it isn't a dagger.
	const HEADING_INNER_RADIUS_M = 1;
	const HEADING_OUTER_RADIUS_M = 10;
	const HEADING_HALF_ANGLE = 45; // degrees either side of heading
	const HEADING_ARC_SEGMENTS = 10;
	const HEADING_BANDS = 16; // more, finer bands read as a smooth fade instead of visible steps
	const HEADING_MAX_OPACITY = 0.8; // nearest the marker
	const HEADING_MIN_OPACITY = 0.2; // at the outer edge

	const EMPTY = { type: 'FeatureCollection', features: [] };

	const zoomExpr = (...stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];

	function offsetMetres([lng, lat], bearingDeg, distanceM) {
		const rad = (bearingDeg * Math.PI) / 180;
		const dLat = (distanceM * Math.cos(rad)) / M_PER_DEG;
		const dLng = (distanceM * Math.sin(rad)) / M_PER_DEG / Math.cos((lat * Math.PI) / 180);
		return [lng + dLng, lat + dLat];
	}

	function headingArc(center, headingDeg, radiusM) {
		const start = headingDeg - HEADING_HALF_ANGLE;
		const end = headingDeg + HEADING_HALF_ANGLE;
		return Array.from({ length: HEADING_ARC_SEGMENTS + 1 }, (_, i) => {
			const bearing = start + ((end - start) * i) / HEADING_ARC_SEGMENTS;
			return offsetMetres(center, bearing, radiusM);
		});
	}

	function headingBands(center, headingDeg) {
		const span = HEADING_OUTER_RADIUS_M - HEADING_INNER_RADIUS_M;
		return Array.from({ length: HEADING_BANDS }, (_, i) => {
			const rInner = HEADING_INNER_RADIUS_M + (span * i) / HEADING_BANDS;
			const rOuter = HEADING_INNER_RADIUS_M + (span * (i + 1)) / HEADING_BANDS;
			const outerArc = headingArc(center, headingDeg, rOuter);
			const innerArc = headingArc(center, headingDeg, rInner).reverse();
			const ring = [...outerArc, ...innerArc, outerArc[0]];
			const t = i / (HEADING_BANDS - 1); // 0 nearest the marker, 1 at the outer edge
			const opacity = HEADING_MAX_OPACITY + (HEADING_MIN_OPACITY - HEADING_MAX_OPACITY) * t;
			return { ring, opacity };
		});
	}

	function buildPoint(currentLocation) {
		return {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: { type: 'Point', coordinates: [currentLocation.lng, currentLocation.lat] }
				}
			]
		};
	}

	function buildWedge(currentLocation, currentHeading) {
		if (currentHeading == null) return EMPTY;
		const center = [currentLocation.lng, currentLocation.lat];
		return {
			type: 'FeatureCollection',
			features: headingBands(center, currentHeading).map(({ ring, opacity }) => ({
				type: 'Feature',
				properties: { opacity },
				geometry: { type: 'Polygon', coordinates: [ring] }
			}))
		};
	}

	function ensureLayers() {
		if (!map.getSource(POINT_SOURCE_ID)) {
			map.addSource(POINT_SOURCE_ID, { type: 'geojson', data: EMPTY });
		}
		if (!map.getSource(WEDGE_SOURCE_ID)) {
			map.addSource(WEDGE_SOURCE_ID, { type: 'geojson', data: EMPTY });
		}
		const before = map.getLayer(beforeId) ? beforeId : undefined;

		// Halo, then heading wedge, then the solid dot on top — the wedge is
		// added after the halo but before the dot so the dot's near edge tucks
		// over the wedge, the same low-key "flashlight beam" language maps apps use.
		if (!map.getLayer(HALO_LAYER_ID)) {
			map.addLayer(
				{
					id: HALO_LAYER_ID,
					type: 'circle',
					source: POINT_SOURCE_ID,
					paint: {
						'circle-radius': zoomExpr(14, 14, 18, 26, 21, 41),
						'circle-color': haloColor,
						'circle-opacity': 0.15
					}
				},
				before
			);
		}
		if (!map.getLayer(HEADING_LAYER_ID)) {
			map.addLayer(
				{
					id: HEADING_LAYER_ID,
					type: 'fill',
					source: WEDGE_SOURCE_ID,
					paint: { 'fill-color': color, 'fill-opacity': ['get', 'opacity'], 'fill-antialias': false }
				},
				before
			);
		}
		if (!map.getLayer(DOT_LAYER_ID)) {
			map.addLayer(
				{
					id: DOT_LAYER_ID,
					type: 'circle',
					source: POINT_SOURCE_ID,
					paint: {
						'circle-radius': zoomExpr(14, 7, 18, 12, 21, 18),
						'circle-color': color,
						'circle-stroke-color': strokeColor,
						'circle-stroke-width': zoomExpr(14, 2.6, 18, 4.3, 21, 6)
					}
				},
				before
			);
		}
	}

	// Held outside the effects so a deferred apply (see below) always uploads
	// the newest data rather than whatever was current when it was scheduled.
	let pointData = EMPTY;
	let wedgeData = EMPTY;

	function applyData() {
		ensureLayers();
		map.getSource(POINT_SOURCE_ID)?.setData(pointData);
		map.getSource(WEDGE_SOURCE_ID)?.setData(wedgeData);
	}

	let deferred = false;

	function push(sourceId, data) {
		// isStyleLoaded() can flicker back to false later (e.g. while new tiles
		// stream in as the camera moves) — 'load' only ever fires once, so once
		// our own layer exists we know the style loaded and can skip that flaky gate.
		if (map.getLayer(DOT_LAYER_ID) || map.isStyleLoaded()) {
			ensureLayers();
			map.getSource(sourceId)?.setData(data);
		} else if (!deferred) {
			// Both effects can land here before the style is ready; one deferred
			// apply covers both sources, and it reads the latest data either way.
			deferred = true;
			map.once('load', applyData);
		}
	}

	// Position: dot and halo only.
	$effect(() => {
		if (!map || !location) return;
		pointData = buildPoint(location);
		push(POINT_SOURCE_ID, pointData);
	});

	// Heading: the wedge only. Reads `location` too (the wedge is anchored to
	// it), but a turn in place re-uploads ~350 coordinates and nothing else.
	$effect(() => {
		if (!map || !location) return;
		wedgeData = buildWedge(location, heading);
		push(WEDGE_SOURCE_ID, wedgeData);
	});

	onDestroy(() => {
		if (!map?.getStyle) return;
		for (const id of [HALO_LAYER_ID, HEADING_LAYER_ID, DOT_LAYER_ID]) {
			if (map.getLayer(id)) map.removeLayer(id);
		}
		for (const id of [POINT_SOURCE_ID, WEDGE_SOURCE_ID]) {
			if (map.getSource(id)) map.removeSource(id);
		}
	});
</script>
