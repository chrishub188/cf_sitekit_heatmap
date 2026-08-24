<script>
	import { onDestroy } from 'svelte';
	import { scaleSequential, interpolateRdYlBu } from 'd3';
	import proj4 from 'proj4';

	let {
		map, // maplibre Map instance (from SiteMap's onready)
		url, // CSV with x,y,pet|value,(ntzg) columns, x/y in UTM32N metres (EPSG:25832)
		pitch = 1, // grid spacing in metres, used to derive cell size
		center, // [lng, lat] centre of the radial clip — updates as the visitor's location changes
		radius = 50, // metres, radius of the clip circle around center
		beforeId = 'site-marker-halo', // insert below the location marker so it stays legible
		excludeNtzg = [20, 21, 30, 32],
		gap = 0.9, // fraction of the grid pitch each cell fills; the rest is gap
		roundness = 5, // superellipse exponent for cell corners; 2 = ellipse, higher = squarer
		opacity = 0.35
	} = $props();

	const SOURCE_ID = 'heatmap-cells';
	const LAYER_ID = 'heatmap-cells-fill';
	const ROUND_SEGMENTS = 24;
	const FILTERED_COLOR = '#141414'; // faint ghost tint for excluded/invalid cells — no stroke, so the map stays visible
	const FILTERED_OPACITY = 0.025;

	// ETRS89 / UTM zone 32N — covers both sites (Mannheim, Kaiserslautern).
	const EPSG25832 = '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
	const project = (x, y) => proj4(EPSG25832, 'WGS84', [x, y]);

	// Unit superellipse sampled once; each cell reuses it via an affine map (below).
	const unitShape = (n) =>
		Array.from({ length: ROUND_SEGMENTS }, (_, i) => {
			const theta = (i / ROUND_SEGMENTS) * Math.PI * 2;
			const c = Math.cos(theta);
			const s = Math.sin(theta);
			return [Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(s) * Math.abs(s) ** (2 / n)];
		});

	const EARTH_RADIUS = 6371000; // metres

	// Great-circle distance between two lon/lat points, in metres.
	function haversine(lng1, lat1, lng2, lat2) {
		const toRad = (d) => (d * Math.PI) / 180;
		const dLat = toRad(lat2 - lat1);
		const dLng = toRad(lng2 - lng1);
		const a =
			Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
		return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
	}

	function median(values) {
		const sorted = [...values].sort((a, b) => a - b);
		const mid = sorted.length >> 1;
		return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	}

	function parseCsv(text) {
		const lines = text.trim().split(/\r?\n/);
		if (lines.length < 2) return [];
		const header = lines[0].split(',').map((h) => h.trim());
		const xi = header.indexOf('x');
		const yi = header.indexOf('y');
		const peti = header.indexOf('pet') !== -1 ? header.indexOf('pet') : header.indexOf('value');
		const ntzgi = header.indexOf('ntzg'); // absent in newer datasets — stays -1, r.ntzg stays NaN
		return lines
			.slice(1)
			.map((line) => {
				const cols = line.split(',');
				return {
					x: parseFloat(cols[xi]),
					y: parseFloat(cols[yi]),
					pet: parseFloat(cols[peti]),
					ntzg: parseInt(cols[ntzgi], 10)
				};
			})
			.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y));
	}

	// Fetched and reprojected once per url, then reused as the visitor's location
	// (and so the radial clip) moves — refiltering in-memory rows is cheap, a
	// network fetch + CSV parse on every location update would not be.
	const rowsCache = new Map(); // url -> { rows: projected [{x,y,pet,ntzg}], anchor: raw first row }

	async function loadRows(currentUrl) {
		if (rowsCache.has(currentUrl)) return rowsCache.get(currentUrl);
		let raw = [];
		try {
			const res = await fetch(currentUrl);
			if (res.ok) raw = parseCsv(await res.text());
		} catch (err) {
			console.warn(`heatmap: failed to load ${currentUrl}`, err);
		}
		const entry = {
			rows: raw.map((r) => {
				const [x, y] = project(r.x, r.y);
				return { ...r, x, y };
			}),
			anchor: raw[0]
		};
		rowsCache.set(currentUrl, entry);
		return entry;
	}

	function buildGeoJson(rows, anchor, currentCenter, currentRadius) {
		if (rows.length === 0 || !anchor) return null;

		const isFiltered = (r) => excludeNtzg.includes(r.ntzg) || !Number.isFinite(r.pet);
		const [clng, clat] = currentCenter;
		const inRadius = (r) => haversine(r.x, r.y, clng, clat) <= currentRadius;

		const included = rows.filter((r) => !isFiltered(r) && inRadius(r));
		const filtered = rows.filter((r) => isFiltered(r) && inRadius(r));
		if (included.length === 0 && filtered.length === 0) return null;

		// The 1 m dataset is a known regular grid (pitch metres, axis-aligned in
		// UTM) but isn't guaranteed to be written in any particular row order, so
		// the pitch vectors are derived analytically by reprojecting a probe
		// offset near the data rather than inferred from row-to-row deltas.
		const [ax, ay] = project(anchor.x, anchor.y);
		const [adx, ady] = project(anchor.x + pitch, anchor.y);
		const [bdx, bdy] = project(anchor.x, anchor.y + pitch);
		const Ah = { x: ((adx - ax) / 2) * gap, y: ((ady - ay) / 2) * gap };
		const Bh = { x: ((bdx - ax) / 2) * gap, y: ((bdy - ay) / 2) * gap };
		const shape = unitShape(roundness);

		const pets = included.map((r) => r.pet);
		const min = pets.length ? Math.min(...pets) : null;
		const max = pets.length ? Math.max(...pets) : null;
		// Domain reversed ([max, min]) so higher PET maps to the interpolator's red end.
		const color =
			min != null && max != null && max > min
				? scaleSequential(interpolateRdYlBu).domain([max, min])
				: () => interpolateRdYlBu(0.5);

		const toFeature = (r, cellColor, isFilteredCell) => {
			const cx = r.x;
			const cy = r.y;
			const ring = shape.map(([sx, sy]) => [cx + sx * Ah.x + sy * Bh.x, cy + sx * Ah.y + sy * Bh.y]);
			ring.push(ring[0]);
			return {
				type: 'Feature',
				properties: { pet: r.pet, color: cellColor, filtered: isFilteredCell },
				geometry: { type: 'Polygon', coordinates: [ring] }
			};
		};

		const features = [
			...included.map((r) => toFeature(r, color(r.pet), false)),
			...filtered.map((r) => toFeature(r, FILTERED_COLOR, true))
		];

		return { type: 'FeatureCollection', features };
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
						'fill-color': ['get', 'color'],
						'fill-opacity': ['case', ['==', ['get', 'filtered'], true], FILTERED_OPACITY, opacity]
					}
				},
				before
			);
		}
	}

	function setData(geojson) {
		map.getSource(SOURCE_ID)?.setData(geojson ?? { type: 'FeatureCollection', features: [] });
	}

	async function refresh(currentUrl, currentCenter, currentRadius) {
		if (!map || !currentUrl || !currentCenter) return;
		const { rows, anchor } = await loadRows(currentUrl);
		const geojson = buildGeoJson(rows, anchor, currentCenter, currentRadius);

		const apply = () => {
			ensureLayer();
			setData(geojson);
		};
		// isStyleLoaded() can flicker back to false later (e.g. while new tiles
		// stream in as the camera moves) — 'load' only ever fires once, so once
		// the layer exists we know the style loaded and can skip that flaky gate.
		if (map.getLayer(LAYER_ID) || map.isStyleLoaded()) apply();
		else map.once('load', apply);
	}

	$effect(() => {
		refresh(url, center, radius);
	});

	onDestroy(() => {
		if (!map?.getStyle) return;
		if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
		if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
	});
</script>
