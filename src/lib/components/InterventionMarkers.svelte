<script>
	import { onDestroy } from 'svelte';

	// Parameters mirror the Tree Icon Maker panel one to one (same names, same
	// units, same defaults as the exported icon), so a look tuned there can be
	// copied straight across. The one deliberate difference: "Icon size" is
	// replaced by `radiusM` — the crown is drawn at true ground size rather
	// than as a fixed-pixel icon, so it lines up with the heatmap's 1 m cells.
	let {
		map, // maplibre Map instance (from SiteMap's onready)
		markers = [], // [{ lng, lat, type, isNew, orientation }] — see intervention.js's parseInterventionMarker; empty = nothing drawn
		radiusM = 3.25, // crown size on the ground: outer reach of the lobes, in metres (replaces "Icon size")

		// Shape
		lobes = 10, // Lobes
		lobeDepth = 0.94, // Lobe depth, 0–1: each lobe's arc spans lobeDepth × 120°; 0 = flat (polygon), 1 = deepest
		spacingIrregularity = 0.2, // Spacing irregularity, 0–1: how unevenly the notches are spaced around the crown
		radiusIrregularity = 0, // Radius irregularity, 0–1: how unevenly far the notches sit from the centre
		rotation = 0, // Rotation, degrees clockwise; the intervention's own `orientation` is added on top
		seed = 7, // Seed
		varyPerTree = true, // not in the maker: mix each tree's position into the seed, so a row of trees isn't stamped from one template

		// Size & stroke (screen pixels)
		outlineWidth = 1.75, // Outline width
		haloWidth = 1, // Halo width — outside the outline only, like the maker's masked halo
		centerDot = 0, // Center dot radius; 0 = no dot

		// Color
		fill = '#E6E2D2', // Fill
		fillOpacity = 0.1, // Fill opacity
		outline = '#68655E', // Outline
		halo = '#FFFFFF', // Halo
		haloOpacity = 0.55, // Halo opacity
		dot = '#3F3D39', // Dot

		beforeId = 'location-marker-halo' // above the heatmap, below the visitor's own marker
	} = $props();

	const CROWN_SOURCE_ID = 'intervention-markers';
	const DOT_SOURCE_ID = 'intervention-markers-dot';
	const FILL_LAYER_ID = 'intervention-marker'; // Heatmap.svelte inserts itself below this id
	const HALO_LAYER_ID = 'intervention-marker-halo';
	const OUTLINE_LAYER_ID = 'intervention-marker-outline';
	const DOT_LAYER_ID = 'intervention-marker-dot';

	/** @typedef {import('$lib/intervention.js').InterventionMarker} InterventionMarker */

	const EMPTY = { type: 'FeatureCollection', features: [] };

	const M_PER_DEG = 111320;
	const SAMPLES_PER_LOBE = 10;
	const CIRCLE_SAMPLES = 48; // non-tree interventions: a plain circle

	// Small deterministic PRNG (mulberry32). Seeded from `seed`, plus the
	// tree's position when varyPerTree is on — so the same tree keeps the same
	// crown every time a new grid redraws it.
	/** @param {number} s */
	function mulberry32(s) {
		let a = s | 0;
		return () => {
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	/** @param {InterventionMarker} m */
	function seedFor(m) {
		if (!varyPerTree) return seed;
		return seed ^ (Math.round(m.lng * 1e7) * 73856093) ^ (Math.round(m.lat * 1e7) * 19349663);
	}

	// The crown, built the way the maker's exported SVG is: `lobes` notch
	// points around the centre, each pair joined by an outward-bulging
	// circular arc (one SVG `A … 0 0 1` per lobe). Measured from the export:
	//   - every arc spans lobeDepth × 120°, so its radius is
	//     halfChord / sin(lobeDepth × 60°) — 93 % gives the export's 1.21 ratio;
	//   - notches sit at one shared radius, varied by radiusIrregularity, and
	//     at evenly spaced angles, each shifted by up to ±spacingIrregularity/2
	//     of a step.
	// Built in unit space, scaled so the outer reach is radiusM, then turned
	// into lng/lat — true size at every zoom. Traversed clockwise (north up);
	// the halo's line-offset relies on that.
	/** @param {InterventionMarker} m */
	function crownPoints(m) {
		const rand = mulberry32(seedFor(m));
		const n = Math.max(3, Math.round(lobes));
		const step = (2 * Math.PI) / n;
		const rot = ((rotation + m.orientation) * Math.PI) / 180;

		/** @type {[number, number][]} */
		const notches = [];
		for (let i = 0; i < n; i++) {
			const theta = rot + step * (i + (rand() - 0.5) * spacingIrregularity);
			const r = 1 + (rand() - 0.5) * radiusIrregularity;
			notches.push([r * Math.sin(theta), r * Math.cos(theta)]); // x east, y north
		}

		/** @type {[number, number][]} */
		const pts = [];
		const halfSweep = (Math.min(1, Math.max(0, lobeDepth)) * Math.PI) / 3; // lobeDepth × 60°
		for (let i = 0; i < n; i++) {
			const [x1, y1] = notches[i];
			const [x2, y2] = notches[(i + 1) % n];
			if (halfSweep < 1e-3) {
				pts.push([x1, y1]); // depth 0: straight edges
				continue;
			}
			const half = Math.hypot(x2 - x1, y2 - y1) / 2;
			const rho = half / Math.sin(halfSweep);
			const h = Math.sqrt(Math.max(0, rho * rho - half * half));
			// Arc centre on the inner side of the chord, so the lobe bulges out.
			const mx = (x1 + x2) / 2;
			const my = (y1 + y2) / 2;
			const ml = Math.hypot(mx, my) || 1;
			const ox = mx - (mx / ml) * h;
			const oy = my - (my / ml) * h;
			const a1 = Math.atan2(y1 - oy, x1 - ox);
			let delta = Math.atan2(y2 - oy, x2 - ox) - a1;
			if (delta > Math.PI) delta -= 2 * Math.PI;
			if (delta < -Math.PI) delta += 2 * Math.PI;
			for (let k = 0; k < SAMPLES_PER_LOBE; k++) {
				const a = a1 + (delta * k) / SAMPLES_PER_LOBE;
				pts.push([ox + rho * Math.cos(a), oy + rho * Math.sin(a)]);
			}
		}
		return pts;
	}

	/**
	 * @param {InterventionMarker} m
	 * @param {boolean} isTree
	 */
	function crownRing(m, isTree) {
		/** @type {[number, number][]} */
		let pts;
		if (isTree) {
			pts = crownPoints(m);
		} else {
			pts = Array.from({ length: CIRCLE_SAMPLES }, (_, i) => {
				const t = (2 * Math.PI * i) / CIRCLE_SAMPLES;
				return /** @type {[number, number]} */ ([Math.sin(t), Math.cos(t)]);
			});
		}
		const reach = Math.max(...pts.map(([x, y]) => Math.hypot(x, y)));
		const scale = radiusM / reach;
		const cosLat = Math.cos((m.lat * Math.PI) / 180);
		const ring = pts.map(([x, y]) => [m.lng + (x * scale) / (M_PER_DEG * cosLat), m.lat + (y * scale) / M_PER_DEG]);
		ring.push(ring[0]);
		return ring;
	}

	/** @param {InterventionMarker[]} list */
	function buildCrowns(list) {
		if (!list.length) return EMPTY;
		return {
			type: 'FeatureCollection',
			features: list.map((m) => ({
				type: 'Feature',
				properties: { type: m.type, isNew: m.isNew },
				geometry: { type: 'Polygon', coordinates: [crownRing(m, m.type.startsWith('TREE'))] }
			}))
		};
	}

	/** @param {InterventionMarker[]} list */
	function buildDots(list) {
		if (!list.length || centerDot <= 0) return EMPTY;
		return {
			type: 'FeatureCollection',
			features: list.map((m) => ({
				type: 'Feature',
				properties: { type: m.type, isNew: m.isNew },
				geometry: { type: 'Point', coordinates: [m.lng, m.lat] }
			}))
		};
	}

	function ensureLayers() {
		for (const id of [CROWN_SOURCE_ID, DOT_SOURCE_ID]) {
			if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
		}
		// Above the heatmap whichever was added first: Heatmap.svelte inserts
		// itself below the fill layer once it exists. Below the location marker
		// either way — if its layers aren't there yet, below the street
		// labels, which is where LocationMarker inserts itself later. All go in
		// at the same spot, in order, so they stack fill → halo → outline → dot.
		const before = [beforeId, 'street-label'].find((id) => map.getLayer(id));
		if (!map.getLayer(FILL_LAYER_ID)) {
			map.addLayer(
				{
					id: FILL_LAYER_ID,
					type: 'fill',
					source: CROWN_SOURCE_ID,
					paint: { 'fill-color': fill, 'fill-opacity': fillOpacity }
				},
				before
			);
		}
		// Outside-only halo, like the maker's masked stroke: a line pushed off
		// the outline to its left, which for a clockwise ring is the outside.
		// Negative line-offset = left of the direction of travel.
		if (!map.getLayer(HALO_LAYER_ID)) {
			map.addLayer(
				{
					id: HALO_LAYER_ID,
					type: 'line',
					source: CROWN_SOURCE_ID,
					layout: { 'line-join': 'round' },
					paint: {
						'line-color': halo,
						'line-width': haloWidth,
						'line-offset': -(outlineWidth + haloWidth) / 2,
						'line-opacity': haloOpacity
					}
				},
				before
			);
		}
		if (!map.getLayer(OUTLINE_LAYER_ID)) {
			map.addLayer(
				{
					id: OUTLINE_LAYER_ID,
					type: 'line',
					source: CROWN_SOURCE_ID,
					layout: { 'line-join': 'round' },
					paint: { 'line-color': outline, 'line-width': outlineWidth }
				},
				before
			);
		}
		if (!map.getLayer(DOT_LAYER_ID)) {
			map.addLayer(
				{
					id: DOT_LAYER_ID,
					type: 'circle',
					source: DOT_SOURCE_ID,
					paint: {
						'circle-radius': centerDot,
						'circle-color': dot,
						'circle-stroke-color': halo,
						'circle-stroke-width': haloWidth,
						'circle-stroke-opacity': haloOpacity
					}
				},
				before
			);
		}
	}

	// Held outside the effect so a deferred apply uploads the newest list, not
	// whatever was current when it was scheduled.
	/** @type {InterventionMarker[]} */
	let latest = [];

	function apply() {
		ensureLayers();
		map.getSource(CROWN_SOURCE_ID)?.setData(buildCrowns(latest));
		map.getSource(DOT_SOURCE_ID)?.setData(buildDots(latest));
	}

	let deferred = false;

	$effect(() => {
		if (!map) return;
		latest = markers;
		// isStyleLoaded() can flicker back to false later (e.g. while new tiles
		// stream in as the camera moves) — 'load' only ever fires once, so once
		// a layer is queryable we know the style loaded and can skip that gate.
		if (map.getLayer(FILL_LAYER_ID) || map.getLayer('street-label') || map.isStyleLoaded()) apply();
		else if (!deferred) {
			deferred = true;
			map.once('load', apply);
		}
	});

	onDestroy(() => {
		if (!map?.getStyle) return;
		for (const id of [DOT_LAYER_ID, OUTLINE_LAYER_ID, HALO_LAYER_ID, FILL_LAYER_ID]) {
			if (map.getLayer(id)) map.removeLayer(id);
		}
		for (const id of [CROWN_SOURCE_ID, DOT_SOURCE_ID]) {
			if (map.getSource(id)) map.removeSource(id);
		}
	});
</script>
