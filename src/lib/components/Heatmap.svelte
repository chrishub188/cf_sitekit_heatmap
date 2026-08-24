<script>
	import { onDestroy } from 'svelte';
	import { scaleSequential, interpolateRdYlBu } from 'd3';
	import proj4 from 'proj4';

	let {
		map, // maplibre Map instance (from SiteMap's onready)
		url, // CSV with x,y,pet|value,(ntzg) columns
		crs = 'wgs84', // 'wgs84': x,y already lon,lat — 'epsg25832': x,y are UTM32N metres, reprojected below
		pitch = 1, // grid spacing in metres, only used to derive cell size when crs is 'epsg25832'
		bounds, // [west, south, east, north] — same rect SITE_AREAS draws, clips cells to it
		filterUrl, // GeoJSON Polygon (static/geojson/filter_location/*) tracing the plaza's true outline
		center, // [lng, lat] site centre, used when clipShape is 'circle'
		radius = 100, // metres, radius of the 'circle' clip shape
		clipShape = 'square', // 'square': clip to bounds — 'plaza': clip to the filterUrl polygon — 'circle': clip to radius around center
		beforeId = 'site-marker', // insert below the site chrome so labels stay legible
		excludeNtzg = [20, 21, 30, 32],
		showFiltered = false, // show excluded-ntzg (Schwarzplan) and invalid-value cells as filtered overlay
		gap = 0.9, // fraction of the grid pitch each cell fills; the rest is gap
		roundness = 5, // superellipse exponent for cell corners; 2 = ellipse, higher = squarer
		opacity = 0.35,
		ondomain // called with {min, max} of the loaded PET values, or null, for a legend to reflect
	} = $props();

	const SOURCE_ID = 'heatmap-cells';
	const LAYER_ID = 'heatmap-cells-fill';
	const ROUND_SEGMENTS = 24;
	const FILTERED_COLOR = '#141414'; // faint ghost tint for excluded/invalid cells — no stroke, so the map stays visible
	const FILTERED_OPACITY = 0.025;

	// ETRS89 / UTM zone 32N — covers both sites (Mannheim, Kaiserslautern).
	const EPSG25832 = '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

	// Unit superellipse sampled once; each cell reuses it via an affine map (below).
	const unitShape = (n) =>
		Array.from({ length: ROUND_SEGMENTS }, (_, i) => {
			const theta = (i / ROUND_SEGMENTS) * Math.PI * 2;
			const c = Math.cos(theta);
			const s = Math.sin(theta);
			return [Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(s) * Math.abs(s) ** (2 / n)];
		});

	// Even-odd ray cast; ring[0] is the outer boundary, any further rings are holes.
	function pointInRing(x, y, ring) {
		let inside = false;
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [xi, yi] = ring[i];
			const [xj, yj] = ring[j];
			const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
			if (crosses) inside = !inside;
		}
		return inside;
	}

	function pointInPolygon(x, y, rings) {
		if (!pointInRing(x, y, rings[0])) return false;
		return !rings.slice(1).some((hole) => pointInRing(x, y, hole));
	}

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

	function clipTest(currentClipShape, { bounds, polygonRings, center, radius }) {
		if (currentClipShape === 'plaza' && polygonRings) return (r) => pointInPolygon(r.x, r.y, polygonRings);
		if (currentClipShape === 'circle' && center) {
			const [clng, clat] = center;
			return (r) => haversine(r.x, r.y, clng, clat) <= radius;
		}
		if (!bounds) return null;
		const [west, south, east, north] = bounds;
		return (r) => r.x >= west && r.x <= east && r.y >= south && r.y <= north;
	}

	// Fetched once per filterUrl and kept for the component's lifetime.
	const polygonCache = new Map();

	async function loadPolygon(currentFilterUrl) {
		if (!currentFilterUrl) return null;
		if (polygonCache.has(currentFilterUrl)) return polygonCache.get(currentFilterUrl);
		let rings = null;
		try {
			const res = await fetch(currentFilterUrl);
			if (res.ok) {
				const geojson = await res.json();
				const geometry = geojson.features?.[0]?.geometry;
				if (geometry?.type === 'Polygon') rings = geometry.coordinates;
			}
		} catch (err) {
			console.warn(`heatmap: failed to load filter polygon ${currentFilterUrl}`, err);
		}
		polygonCache.set(currentFilterUrl, rings);
		return rings;
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

	// The generator writes points column by column (y rising within a column,
	// then dropping back down at the next column), so that order recovers the
	// grid's two edge vectors without needing to assume an axis-aligned grid.
	function detectGridVectors(points) {
		const colStarts = [0];
		for (let i = 1; i < points.length; i++) {
			if (points[i].y - points[i - 1].y < 0) colStarts.push(i);
		}

		const rowDx = [];
		const rowDy = [];
		for (let i = 1; i < points.length; i++) {
			const dy = points[i].y - points[i - 1].y;
			if (dy > 0) {
				rowDx.push(points[i].x - points[i - 1].x);
				rowDy.push(dy);
			}
		}

		const colDx = [];
		const colDy = [];
		for (let i = 0; i < colStarts.length - 1; i++) {
			const p0 = points[colStarts[i]];
			const p1 = points[colStarts[i + 1]];
			colDx.push(p1.x - p0.x);
			colDy.push(p1.y - p0.y);
		}

		let A = rowDx.length ? { x: median(rowDx), y: median(rowDy) } : null;
		let B = colDx.length ? { x: median(colDx), y: median(colDy) } : null;
		if (!A && !B) return null;
		if (!A) A = { x: -B.y, y: B.x };
		if (!B) B = { x: A.y, y: -A.x };
		return { A, B };
	}

	// x,y in the CSV's native units: pass-through for wgs84, reprojected from
	// UTM32N metres for epsg25832.
	function projector(currentCrs) {
		return currentCrs === 'epsg25832' ? (x, y) => proj4(EPSG25832, 'WGS84', [x, y]) : (x, y) => [x, y];
	}

	// Returns { geojson, domain } where domain is the {min, max} PET range the
	// color scale was fit to (null if there was no data to color).
	function buildGeoJson(rawRows, currentCrs, currentShowFiltered, currentClipShape, polygonRings) {
		if (rawRows.length === 0) return null;
		const project = projector(currentCrs);
		const rows = rawRows.map((r) => {
			const [x, y] = project(r.x, r.y);
			return { ...r, x, y };
		});

		const isFiltered = (r) => excludeNtzg.includes(r.ntzg) || !Number.isFinite(r.pet);
		let included = rows.filter((r) => !isFiltered(r));
		let filtered = currentShowFiltered ? rows.filter(isFiltered) : [];
		const inBounds = clipTest(currentClipShape, { bounds, polygonRings, center, radius });
		if (inBounds) {
			included = included.filter(inBounds);
			filtered = filtered.filter(inBounds);
		}
		if (included.length === 0 && filtered.length === 0) return null;

		// The 1 m dataset is a known regular grid (pitch metres, axis-aligned in
		// UTM) but isn't guaranteed to be written in any particular row order, so
		// the pitch vectors are derived analytically by reprojecting a probe
		// offset near the data rather than inferred from row-to-row deltas.
		let vectors;
		if (currentCrs === 'epsg25832') {
			const anchor = rawRows[0];
			const [ax, ay] = project(anchor.x, anchor.y);
			const [adx, ady] = project(anchor.x + pitch, anchor.y);
			const [bdx, bdy] = project(anchor.x, anchor.y + pitch);
			vectors = { A: { x: adx - ax, y: ady - ay }, B: { x: bdx - ax, y: bdy - ay } };
		} else {
			vectors = detectGridVectors(rows);
		}
		if (!vectors) return null;
		const Ah = { x: (vectors.A.x / 2) * gap, y: (vectors.A.y / 2) * gap };
		const Bh = { x: (vectors.B.x / 2) * gap, y: (vectors.B.y / 2) * gap };
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

		return {
			geojson: { type: 'FeatureCollection', features },
			domain: min != null ? { min, max } : null
		};
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

	async function load(currentUrl, currentCrs, currentShowFiltered, currentFilterUrl, currentClipShape) {
		if (!map || !currentUrl) return;
		let result = null;
		try {
			const wantsPolygon = currentClipShape === 'plaza' && currentFilterUrl;
			const [res, polygonRings] = await Promise.all([
				fetch(currentUrl),
				wantsPolygon ? loadPolygon(currentFilterUrl) : Promise.resolve(null)
			]);
			if (res.ok) {
				result = buildGeoJson(
					parseCsv(await res.text()),
					currentCrs,
					currentShowFiltered,
					currentClipShape,
					polygonRings
				);
			}
		} catch (err) {
			console.warn(`heatmap: failed to load ${currentUrl}`, err);
		}

		const apply = () => {
			ensureLayer();
			setData(result?.geojson);
			ondomain?.(result?.domain ?? null);
		};
		if (map.isStyleLoaded()) apply();
		else map.once('load', apply);
	}

	$effect(() => {
		load(url, crs, showFiltered, filterUrl, clipShape);
	});

	onDestroy(() => {
		if (!map?.getStyle) return;
		if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
		if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
	});
</script>
