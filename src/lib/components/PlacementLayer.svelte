<script>
	// Placing trees by hand. Owns the whole gesture, whether it starts on a
	// palette tile (a new tree) or on a placed crown (moving it): it follows the
	// pointer on the window, outlines the site's Entwurfsfläche while a tree is
	// held, draws a ghost crown where it would land — green inside the area, red
	// outside — and reports the drop. The trees themselves are TreeOverlay's.
	import { onDestroy, untrack } from 'svelte';
	import CrownIcon from '$lib/components/CrownIcon.svelte';
	import { CROWN_HIT_LAYER } from '$lib/components/TreeOverlay.svelte';
	import { pointInFeatures } from '$lib/clip.js';
	import { shapeRing } from '$lib/geo.js';
	import { CROWN_SHAPE, crownRadius, interventionType, loadPlacementZone } from '$lib/interventions.js';
	import { PAPER, PLANNING_DESIGN, PLANTING_FILL, PLANTING_INK, zoom } from '$lib/style.js';

	let {
		map, // maplibre Map instance (from SiteMap's onready)
		site, // the site on screen; its design area is where trees may go
		removing = $bindable(false), // true while a placed tree is held, so the palette can offer itself as a bin
		onplace, // (type, { lon, lat }) => void
		onmove, // (id, { lon, lat }) => void
		onremove // (id) => void
	} = $props();

	const BLOCKED = '#a2503f'; // the panel's error red
	const MOVE_THRESHOLD_PX = 4; // a press on a crown that travels less is a click, not a move
	// The paper veil over everything outside the design area reaches this far
	// (degrees) around the site: well past the screen at any framing the app uses.
	const VEIL_DEG = 0.2;

	const ZONE_SOURCE = 'placement-zone';
	const GHOST_SOURCE = 'placement-ghost';
	const LAYER_VEIL = 'placement-veil';
	const LAYER_ZONE_FILL = 'placement-zone-fill';
	const LAYER_ZONE_LINE = 'placement-zone-line';
	const LAYER_GHOST_FILL = 'placement-ghost-fill';
	const LAYER_GHOST_LINE = 'placement-ghost-line';
	const LAYER_GHOST_DOT = 'placement-ghost-dot';
	const LAYERS = [LAYER_VEIL, LAYER_ZONE_FILL, LAYER_ZONE_LINE, LAYER_GHOST_FILL, LAYER_GHOST_LINE, LAYER_GHOST_DOT];
	const EMPTY = { type: 'FeatureCollection', features: [] };
	const ifValid = (/** @type {string} */ yes, /** @type {string} */ no) => ['case', ['get', 'valid'], yes, no];
	const kind = (/** @type {string} */ k) => ['==', ['get', 'kind'], k];

	// --- the site's design area --------------------------------------------
	// Loaded per site ahead of any drag, so the first grab already knows where
	// trees may go. `zone.features` null means the site has no restriction.
	/** @type {{ siteId: string, features: any[] | null } | null} */
	let zone = $state.raw(null);

	$effect(() => {
		const current = site;
		let live = true;
		loadPlacementZone(current).then((z) => {
			if (live) zone = { siteId: current.id, features: z?.features ?? null };
		});
		return () => {
			live = false;
		};
	});

	/** @param {number} lng @param {number} lat */
	function allowed(lng, lat) {
		if (!zone || zone.siteId !== site.id) return false; // still loading: nothing is allowed yet
		return zone.features === null || pointInFeatures(lng, lat, zone.features);
	}

	// The design area, plus a veil over everything else: a rectangle around the
	// site with every design polygon cut out of it as a hole.
	/** @param {any[]} features */
	function zoneGeoJson(features) {
		const outers = features.flatMap(({ geometry }) =>
			geometry?.type === 'Polygon'
				? [geometry.coordinates[0]]
				: geometry?.type === 'MultiPolygon'
					? geometry.coordinates.map((/** @type {any} */ p) => p[0])
					: []
		);
		const [lng, lat] = site.center;
		const [w, s, e, n] = [lng - VEIL_DEG, lat - VEIL_DEG, lng + VEIL_DEG, lat + VEIL_DEG];
		const veil = {
			type: 'Feature',
			properties: { kind: 'veil' },
			geometry: { type: 'Polygon', coordinates: [[[w, n], [e, n], [e, s], [w, s], [w, n]], ...outers] }
		};
		const areas = features.map((f) => ({ ...f, properties: { kind: 'zone' } }));
		return { type: 'FeatureCollection', features: [veil, ...areas] };
	}

	// --- map layers --------------------------------------------------------
	function ensureLayers() {
		if (!map.getSource(ZONE_SOURCE)) map.addSource(ZONE_SOURCE, { type: 'geojson', data: EMPTY });
		if (!map.getSource(GHOST_SOURCE)) map.addSource(GHOST_SOURCE, { type: 'geojson', data: EMPTY });
		// Added without a beforeId, so above everything: while a tree is held,
		// where it may go matters more than any other layer.
		const layers = [
			{
				id: LAYER_VEIL,
				type: 'fill',
				source: ZONE_SOURCE,
				filter: kind('veil'),
				paint: { 'fill-color': PAPER, 'fill-opacity': 0.45 }
			},
			{
				id: LAYER_ZONE_FILL,
				type: 'fill',
				source: ZONE_SOURCE,
				filter: kind('zone'),
				paint: { 'fill-color': PLANNING_DESIGN, 'fill-opacity': 0.1 }
			},
			{
				id: LAYER_ZONE_LINE,
				type: 'line',
				source: ZONE_SOURCE,
				filter: kind('zone'),
				layout: { 'line-join': 'round' },
				paint: { 'line-color': PLANNING_DESIGN, 'line-width': zoom(14, 1.5, 18, 3, 21, 4.5) }
			},
			{
				id: LAYER_GHOST_FILL,
				type: 'fill',
				source: GHOST_SOURCE,
				filter: kind('crown'),
				paint: { 'fill-color': ifValid(PLANTING_FILL, BLOCKED), 'fill-opacity': 0.5 }
			},
			{
				id: LAYER_GHOST_LINE,
				type: 'line',
				source: GHOST_SOURCE,
				filter: kind('crown'),
				layout: { 'line-join': 'round' },
				paint: {
					'line-color': ifValid(PLANTING_INK, BLOCKED),
					'line-width': zoom(14, 0.8, 18, 1.6, 21, 2.4),
					'line-dasharray': [3, 2]
				}
			},
			// The crown's real size can be a few pixels when zoomed out; the dot
			// keeps the drop point visible.
			{
				id: LAYER_GHOST_DOT,
				type: 'circle',
				source: GHOST_SOURCE,
				filter: kind('dot'),
				paint: {
					'circle-radius': 3.5,
					'circle-color': ifValid(PLANTING_INK, BLOCKED),
					'circle-stroke-color': PAPER,
					'circle-stroke-width': 1
				}
			}
		];
		for (const layer of layers) if (!map.getLayer(layer.id)) map.addLayer(/** @type {any} */ (layer));
	}

	/** @param {string} id @param {any} data */
	function setData(id, data) {
		/** @type {any} */ (map.getSource(id))?.setData(data);
	}

	// --- the gesture -------------------------------------------------------
	/**
	 * @typedef {{
	 *   type: string, id: string | null, startX: number, startY: number, x: number, y: number,
	 *   moved: boolean, overMap: boolean, overBin: boolean, valid: boolean, lngLat: [number, number] | null
	 * }} Drag
	 */
	let drag = $state(/** @type {Drag | null} */ (null));

	/**
	 * Starts holding a tree. Called by the page for a palette tile, and from the
	 * map's own events below for a crown already placed.
	 * @param {string} type @param {number} clientX @param {number} clientY @param {string | null} [id]
	 */
	export function begin(type, clientX, clientY, id = null) {
		if (drag) end();
		drag = {
			type,
			id,
			startX: clientX,
			startY: clientY,
			x: clientX,
			y: clientY,
			// A new tree is "moved" from the start, so its zone shows on the grab;
			// a placed one only once the pointer has travelled, so a click doesn't flash it.
			moved: id === null,
			overMap: false,
			overBin: false,
			valid: false,
			lngLat: null
		};
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
		window.addEventListener('pointercancel', end);
		window.addEventListener('keydown', onKey);
		track(clientX, clientY);
	}

	/** @param {number} x @param {number} y */
	function track(x, y) {
		if (!drag) return;
		drag.x = x;
		drag.y = y;
		if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) >= MOVE_THRESHOLD_PX) drag.moved = true;
		removing = drag.moved && drag.id !== null;

		// The floating icon has pointer-events: none, so this finds what's under it.
		const el = document.elementFromPoint(x, y);
		drag.overMap = el === map.getCanvas();
		drag.overBin = !!el?.closest('[data-intervention-bin]');
		if (drag.overMap) {
			const rect = map.getCanvas().getBoundingClientRect();
			const { lng, lat } = map.unproject([x - rect.left, y - rect.top]);
			drag.lngLat = [lng, lat];
			drag.valid = allowed(lng, lat);
		} else {
			drag.lngLat = null;
			drag.valid = false;
		}
		paint();
	}

	function paint() {
		if (!map) return;
		ensureLayers();
		const features = drag?.moved && zone && zone.siteId === site.id ? zone.features : null;
		setData(ZONE_SOURCE, features ? zoneGeoJson(features) : EMPTY);
		if (!drag?.moved || !drag.lngLat) {
			setData(GHOST_SOURCE, EMPTY);
		} else {
			const [lng, lat] = drag.lngLat;
			const properties = { valid: drag.valid };
			setData(GHOST_SOURCE, {
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						properties: { ...properties, kind: 'crown' },
						geometry: { type: 'Polygon', coordinates: [shapeRing(lng, lat, crownRadius(drag.type), CROWN_SHAPE)] }
					},
					{ type: 'Feature', properties: { ...properties, kind: 'dot' }, geometry: { type: 'Point', coordinates: [lng, lat] } }
				]
			});
		}
		const cursor = !drag?.moved ? '' : drag.valid || drag.overBin ? 'grabbing' : 'not-allowed';
		map.getCanvas().style.cursor = cursor;
		document.documentElement.style.cursor = cursor;
	}

	/** @param {PointerEvent} e */
	function onPointerMove(e) {
		track(e.clientX, e.clientY);
	}

	/** @param {PointerEvent} e */
	function onPointerUp(e) {
		track(e.clientX, e.clientY);
		const done = drag;
		end();
		if (!done?.moved) return; // a click on a placed crown
		if (done.id !== null && done.overBin) onremove?.(done.id);
		else if (done.valid && done.lngLat) {
			const [lon, lat] = done.lngLat;
			if (done.id !== null) onmove?.(done.id, { lon, lat });
			else onplace?.(done.type, { lon, lat });
		}
		// Anywhere else (outside the area, off the map, over a panel) the drop is
		// dropped: a new tree never lands, a moved one stays where it was.
	}

	/** @param {KeyboardEvent} e */
	function onKey(e) {
		if (e.key === 'Escape') end();
	}

	function end() {
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', onPointerUp);
		window.removeEventListener('pointercancel', end);
		window.removeEventListener('keydown', onKey);
		drag = null;
		removing = false;
		paint();
	}

	// --- placed crowns: move, remove, hover --------------------------------
	// The placed tree under `point`. A large crown easily covers a small tree
	// next to it, so of every crown hit, the one whose centre is nearest wins —
	// pressing on a tree's own centre always picks that tree.
	/** @param {{ x: number, y: number }} point @returns {{ id: string, type: string } | null} */
	function placedAt(point) {
		if (!map.getLayer(CROWN_HIT_LAYER)) return null;
		let best = null;
		let bestDistance = Infinity;
		for (const f of map.queryRenderedFeatures([point.x, point.y], { layers: [CROWN_HIT_LAYER] })) {
			const p = f.properties;
			if (!p?.manual || !p.id) continue;
			const centre = map.project([p.lon, p.lat]);
			const distance = Math.hypot(centre.x - point.x, centre.y - point.y);
			if (distance < bestDistance) [best, bestDistance] = [p, distance];
		}
		return best ? { id: String(best.id), type: String(best.type) } : null;
	}

	/** @param {any} e */
	function onMouseDown(e) {
		if (e.originalEvent.button !== 0) return;
		const tree = placedAt(e.point);
		if (!tree) return;
		e.preventDefault(); // tells MapLibre not to pan for this press
		begin(tree.type, e.originalEvent.clientX, e.originalEvent.clientY, tree.id);
	}

	/** @param {any} e */
	function onTouchStart(e) {
		if (e.points.length !== 1) return;
		const tree = placedAt(e.point);
		if (!tree) return;
		e.preventDefault();
		const touch = e.originalEvent.touches[0];
		begin(tree.type, touch.clientX, touch.clientY, tree.id);
	}

	/** @param {any} e */
	function onContextMenu(e) {
		const tree = placedAt(e.point);
		if (!tree) return;
		e.preventDefault();
		e.originalEvent.preventDefault(); // no browser menu over a tree
		onremove?.(tree.id);
	}

	/** @param {any} e */
	function onHover(e) {
		if (drag) return;
		map.getCanvas().style.cursor = placedAt(e.point) ? 'grab' : '';
	}

	$effect(() => {
		if (!map) return;
		const m = map;
		m.on('mousedown', onMouseDown);
		m.on('touchstart', onTouchStart);
		m.on('contextmenu', onContextMenu);
		m.on('mousemove', onHover);
		return () => {
			m.off('mousedown', onMouseDown);
			m.off('touchstart', onTouchStart);
			m.off('contextmenu', onContextMenu);
			m.off('mousemove', onHover);
		};
	});

	// A site switch mid-drag would leave the old site's area outlined.
	$effect(() => {
		site;
		untrack(() => drag && end());
	});

	onDestroy(() => {
		if (drag) end();
		if (!map?.getStyle) return;
		for (const id of [...LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id);
		for (const id of [GHOST_SOURCE, ZONE_SOURCE]) if (map.getSource(id)) map.removeSource(id);
	});

	const held = $derived(drag ? interventionType(drag.type) : null);
</script>

<!-- Off the map the ghost crown can't be drawn, so a copy of the palette icon
     follows the pointer instead. Over the map the ghost takes over. -->
{#if drag?.moved && !drag.overMap && held}
	<div class="float" style:left="{drag.x}px" style:top="{drag.y}px">
		<CrownIcon size={held.icon} />
	</div>
{/if}

<style>
	.float {
		position: fixed;
		z-index: 10;
		transform: translate(-50%, -50%);
		pointer-events: none;
		opacity: 0.85;
	}
</style>
