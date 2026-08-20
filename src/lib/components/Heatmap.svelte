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
		beforeId = 'site-marker', // insert below the site chrome so labels stay legible
		excludeNtzg = [20, 21, 30, 32],
		gap = 0.9, // fraction of the grid pitch each cell fills; the rest is gap
		roundness = 5, // superellipse exponent for cell corners; 2 = ellipse, higher = squarer
		opacity = 0.35
	} = $props();

	const SOURCE_ID = 'heatmap-cells';
	const LAYER_ID = 'heatmap-cells-fill';
	const ROUND_SEGMENTS = 24;

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
			.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.pet));
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

	function buildGeoJson(rawRows, currentCrs) {
		if (rawRows.length === 0) return null;
		const project = projector(currentCrs);
		const rows = rawRows.map((r) => {
			const [x, y] = project(r.x, r.y);
			return { ...r, x, y };
		});

		let included = rows.filter((r) => !excludeNtzg.includes(r.ntzg));
		if (bounds) {
			const [west, south, east, north] = bounds;
			included = included.filter((r) => r.x >= west && r.x <= east && r.y >= south && r.y <= north);
		}
		if (included.length === 0) return null;

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
		const min = Math.min(...pets);
		const max = Math.max(...pets);
		// Domain reversed ([max, min]) so higher PET maps to the interpolator's red end.
		const color =
			max > min ? scaleSequential(interpolateRdYlBu).domain([max, min]) : () => interpolateRdYlBu(0.5);

		const features = included.map((r) => {
			const cx = r.x;
			const cy = r.y;
			const ring = shape.map(([sx, sy]) => [cx + sx * Ah.x + sy * Bh.x, cy + sx * Ah.y + sy * Bh.y]);
			ring.push(ring[0]);
			return {
				type: 'Feature',
				properties: { pet: r.pet, color: color(r.pet) },
				geometry: { type: 'Polygon', coordinates: [ring] }
			};
		});

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
					paint: { 'fill-color': ['get', 'color'], 'fill-opacity': opacity }
				},
				before
			);
		}
	}

	function setData(geojson) {
		map.getSource(SOURCE_ID)?.setData(geojson ?? { type: 'FeatureCollection', features: [] });
	}

	async function load(currentUrl, currentCrs) {
		if (!map || !currentUrl) return;
		let geojson = null;
		try {
			const res = await fetch(currentUrl);
			if (res.ok) geojson = buildGeoJson(parseCsv(await res.text()), currentCrs);
		} catch (err) {
			console.warn(`heatmap: failed to load ${currentUrl}`, err);
		}

		const apply = () => {
			ensureLayer();
			setData(geojson);
		};
		if (map.isStyleLoaded()) apply();
		else map.once('load', apply);
	}

	$effect(() => {
		load(url, crs);
	});

	onDestroy(() => {
		if (!map?.getStyle) return;
		if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
		if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
	});
</script>
