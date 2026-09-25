<script>
	import { onDestroy } from 'svelte';
	import proj4 from 'proj4';
	import { clipTest, loadPolygon } from '$lib/clip.js';
	import { EPSG25832 } from '$lib/geo.js';

	let {
		map, // maplibre Map instance (from SiteMap's onready)
		rows = null, // { x, y, pet } cell centres in UTM32N metres (see gridToRows); null clears the layer
		pitch = 1, // grid spacing in metres, used to derive the cell size
		bounds, // [west, south, east, north] — the rect 'square'/'full' clip to; the caller picks which
		filterUrl, // GeoJSON Polygon (static/geojson/filter_location/*) tracing the plaza's true outline
		center, // [lng, lat] site centre, used when clipShape is 'circle'
		radius = 100, // metres, radius of the 'circle' clip shape
		clipShape = 'square', // 'square'/'full': clip to bounds — 'plaza': clip to the filterUrl polygon — 'circle': clip to radius around center
		beforeId = 'overlay-anchor', // insert below the anchor so overlays stack predictably
		showFiltered = false, // show cells without a value (buildings — the Schwarzplan) as filtered overlay
		visible = true, // false hides the layer but keeps the loaded data, the domain and the paint expression
		gap = 0.9, // fraction of the grid pitch each cell fills; the rest is gap
		roundness = 5, // superellipse exponent for cell corners; 2 = ellipse, higher = squarer
		opacity = 0.35,
		scaleMin = null, // PET pinned to the blue end; null = use the loaded data's minimum
		scaleMax = null, // PET pinned to the red end; null = use the loaded data's maximum
		ramp, // t -> colour, t=0 at the low PET end and t=1 at the high end (see colorSchemes.js)
		ondomain // called with {min, max} of the loaded PET values, or null, for a legend to reflect
	} = $props();

	const SOURCE_ID = 'heatmap-cells';
	const LAYER_ID = 'heatmap-cells-fill';
	const ROUND_SEGMENTS = 24;
	// Past this many cells the grid is only ever framed zoomed far enough out that a
	// cell covers about a pixel, so the superellipse corners cost vertices — the
	// bulk of the geometry — that nobody can see. Only 300 m at 1 m reaches it.
	const COARSE_SEGMENTS = 8;
	const COARSE_ABOVE = 8000; // cells
	const COLOR_STOPS = 16; // samples of the continuous ramp handed to MapLibre's interpolate
	const FILTERED_COLOR = '#141414'; // faint ghost tint for excluded/invalid cells — no stroke, so the map stays visible
	const FILTERED_OPACITY = 0.03;

	// Cells carry their raw PET and are colored by a paint expression rather than
	// a baked-in color, so moving the scale limits is a repaint, not a reload.
	// lo sits at the ramp's low end, hi at its high end; MapLibre clamps values
	// outside [lo, hi] to the end stops.
	function colorExpression(lo, hi, colorRamp) {
		const color = (v) => colorRamp((v - lo) / (hi - lo));
		const stops =
			hi > lo
				? [
						'interpolate',
						['linear'],
						['get', 'pet'],
						...Array.from({ length: COLOR_STOPS + 1 }, (_, i) => {
							const value = lo + (i / COLOR_STOPS) * (hi - lo);
							return [value, color(value)];
						}).flat()
					]
				: colorRamp(0.5);
		return ['case', ['==', ['get', 'filtered'], true], FILTERED_COLOR, stops];
	}

	// Unit superellipse sampled once; each cell reuses it via an affine map (below).
	const unitShape = (n, segments) =>
		Array.from({ length: segments }, (_, i) => {
			const theta = (i / segments) * Math.PI * 2;
			const c = Math.cos(theta);
			const s = Math.sin(theta);
			return [Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(s) * Math.abs(s) ** (2 / n)];
		});

	const project = (x, y) => proj4(EPSG25832, 'WGS84', [x, y]);

	// Returns { geojson, domain } where domain is the {min, max} PET range the
	// color scale was fit to (null if there was no data to color).
	function buildGeoJson(rawRows, currentPitch, currentShowFiltered, currentClipShape, polygonRings) {
		if (rawRows.length === 0) return null;
		const rows = rawRows.map((r) => {
			const [x, y] = project(r.x, r.y);
			return { ...r, x, y };
		});

		const isFiltered = (r) => !Number.isFinite(r.pet);
		let included = rows.filter((r) => !isFiltered(r));
		let filtered = currentShowFiltered ? rows.filter(isFiltered) : [];
		const inBounds = clipTest(currentClipShape, { bounds, polygonRings, center, radius });
		if (inBounds) {
			included = included.filter((r) => inBounds(r.x, r.y));
			filtered = filtered.filter((r) => inBounds(r.x, r.y));
		}
		if (included.length === 0 && filtered.length === 0) return null;

		// The grid is regular and axis-aligned in UTM, so the pitch vectors are
		// derived analytically by reprojecting a probe offset near the data.
		const anchor = rawRows[0];
		const [ax, ay] = project(anchor.x, anchor.y);
		const [adx, ady] = project(anchor.x + currentPitch, anchor.y);
		const [bdx, bdy] = project(anchor.x, anchor.y + currentPitch);
		const vectors = { A: { x: adx - ax, y: ady - ay }, B: { x: bdx - ax, y: bdy - ay } };
		const Ah = { x: (vectors.A.x / 2) * gap, y: (vectors.A.y / 2) * gap };
		const Bh = { x: (vectors.B.x / 2) * gap, y: (vectors.B.y / 2) * gap };
		const cellCount = included.length + filtered.length;
		const shape = unitShape(roundness, cellCount > COARSE_ABOVE ? COARSE_SEGMENTS : ROUND_SEGMENTS);

		// A loop, not Math.min(...pets): the 300 m crop at 1 m passes 40k cells, which
		// is at or past the argument-count limit in some engines.
		/** @type {{ min: number, max: number } | null} */
		let domain = null;
		for (const r of included) {
			if (!domain) domain = { min: r.pet, max: r.pet };
			else if (r.pet < domain.min) domain.min = r.pet;
			else if (r.pet > domain.max) domain.max = r.pet;
		}

		const toFeature = (r, isFilteredCell) => {
			const cx = r.x;
			const cy = r.y;
			const ring = shape.map(([sx, sy]) => [cx + sx * Ah.x + sy * Bh.x, cy + sx * Ah.y + sy * Bh.y]);
			ring.push(ring[0]);
			return {
				type: 'Feature',
				// pet is null on filtered cells (NaN isn't representable in GeoJSON);
				// the paint expression short-circuits on `filtered` before reading it.
				properties: { pet: Number.isFinite(r.pet) ? r.pet : null, filtered: isFilteredCell },
				geometry: { type: 'Polygon', coordinates: [ring] }
			};
		};

		const features = [
			...included.map((r) => toFeature(r, false)),
			...filtered.map((r) => toFeature(r, true))
		];

		return { geojson: { type: 'FeatureCollection', features }, domain };
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
					layout: { visibility: visible ? 'visible' : 'none' },
					paint: {
						'fill-color': ramp(0.5), // replaced by the repaint effect below
						'fill-opacity': ['case', ['==', ['get', 'filtered'], true], FILTERED_OPACITY, opacity]
					}
				},
				before
			);
		}
		layerReady = true;
	}

	function setData(geojson) {
		map.getSource(SOURCE_ID)?.setData(geojson ?? { type: 'FeatureCollection', features: [] });
	}

	// Resolves once the map can accept a source, and is memoised so every load
	// awaits the same gate. It can't be re-tested per load: `isStyleLoaded()`
	// goes false again whenever a source is still settling — including our own,
	// right after a setData — while 'load' only ever fires once, so a later test
	// can attach to an event that has already passed and drop that update for
	// good. 'idle' is the backstop, since it fires again after every settle.
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

	// Only the newest load may touch the map. Switching clip shape to 'plaza'
	// fetches a polygon the other shapes don't, so an earlier, slower request
	// could otherwise resolve last and repaint the shape the user just left.
	let generation = 0;

	// No rows (a grid still loading, or one that failed) clears the layer, so a
	// site switch never leaves the previous site's cells and domain behind.
	async function load(currentRows, currentPitch, currentShowFiltered, currentFilterUrl, currentClipShape) {
		if (!map) return;
		const token = ++generation;
		let result = null;
		if (currentRows) {
			try {
				const wantsPolygon = currentClipShape === 'plaza' && currentFilterUrl;
				const polygonRings = wantsPolygon ? await loadPolygon(currentFilterUrl) : null;
				result = buildGeoJson(currentRows, currentPitch, currentShowFiltered, currentClipShape, polygonRings);
			} catch (err) {
				console.warn('heatmap: failed to build grid cells', err);
			}
		}

		await mapReady();
		if (token !== generation) return; // superseded while we were fetching
		ensureLayer();
		setData(result?.geojson);
		dataDomain = result?.domain ?? null;
		ondomain?.(dataDomain);
	}

	// PET range of the data currently on the map; the fallback for either
	// unset scale limit, and what a legend shows as the "auto" range.
	/** @type {{ min: number, max: number } | null} */
	let dataDomain = $state(null);
	let layerReady = $state(false);

	$effect(() => {
		load(rows, pitch, showFiltered, filterUrl, clipShape);
	});

	// Repaint on its own, so dragging the scale limits or switching the colour
	// scheme never rebuilds the cells.
	$effect(() => {
		const lo = scaleMin ?? dataDomain?.min;
		const hi = scaleMax ?? dataDomain?.max;
		if (!layerReady || lo == null || hi == null || !map.getLayer(LAYER_ID)) return;
		map.setPaintProperty(LAYER_ID, 'fill-color', colorExpression(lo, hi, ramp));
	});

	// Hiding is a layout flip, not an unmount: the cells, their domain and the
	// colour ramp all survive, so switching back is instant and the legend keeps
	// showing the real range of the data it's describing.
	$effect(() => {
		if (!layerReady || !map.getLayer(LAYER_ID)) return;
		map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
	});

	onDestroy(() => {
		if (!map?.getStyle) return;
		if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
		if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
	});
</script>
