// Custom map style for the Shortbread 1.0 schema served by VersaTiles.
// Warm paper site plan: cream ground, tan paving, hairline buildings, sage planting.

import { SITE_AREAS } from '$lib/sites.js';

const SRC = 'versatiles-shortbread';

// --- aerial imagery --------------------------------------------------------
// The states' own 20 cm orthophotos (open data, dl-de/by-2-0): sharper than
// global imagery, dated, and the survey the planning areas are drawn against.
// Every site lies in one of the two states, so there is no global fallback —
// one underneath would still be fetched, credited, and flash up first while
// the slower WMS tiles load. Outside both states the site plan shows through.
// Each state's WMS clips at its own border and leaves the rest transparent, so
// the two stack cleanly across the Rhine at Mannheim/Ludwigshafen.
const YEAR = new Date().getFullYear(); // the licence cites the year of retrieval
// Keeps one source's credit on one line, so a wrapping attribution breaks
// between credits rather than inside one.
/** @param {string} html */
const credit = (html) => `<span style="white-space: nowrap">${html}</span>`;
/** @param {string} url @param {string} layer */
const wms = (url, layer) =>
	`${url}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=` +
	'&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE';
const IMAGERY = {
	'satellite-rlp': {
		type: 'raster',
		tiles: [wms('https://geo4.service24.rlp.de/wms/rp_dop20.fcgi', 'rp_dop20')],
		tileSize: 256,
		bounds: [6.04, 48.9, 8.62, 51.01], // the service's advertised extent
		maxzoom: 20, // 20 cm pixels, so z20 is native on high-DPI screens
		attribution: credit(`©GeoBasis-DE / LVermGeoRP (${YEAR}), <a href="https://www.govdata.de/dl-de/by-2-0">dl-de/by-2-0</a>`)
	},
	'satellite-bw': {
		type: 'raster',
		tiles: [wms('https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C', 'IMAGES_DOP_20_RGB')],
		tileSize: 256,
		bounds: [7.2, 47.4, 10.7, 50],
		maxzoom: 20,
		// The service's terms accept the short licence name in place of the long one.
		attribution: credit(`LGL-BW (${YEAR}), <a href="https://www.govdata.de/dl-de/by-2-0">dl-de/by-2-0</a>`)
	}
};
// Layer ids, bottom to top, switched on and off together by the basemap switch.
export const SATELLITE_LAYERS = Object.keys(IMAGERY);

export const PAPER = '#F1EBDF';
const PAVING = '#E5DBC7';
const EDGE = '#D5C9B1';
export const INK = '#9A9081';
// Planting greens. The fill is a muted sage that sits just above the basemap's
// land-planting #CBD6BB, so a crown reads as canopy rather than as a marker;
// the ink is the darker edge and centre dot drawn on top of it.
export const PLANTING_FILL = '#9DB491';
export const PLANTING_INK = '#6F8A57';

// Planning areas. Assigned by role and file number rather than by name, so
// any site's files get colours; all of them keep clear of the heatmap's
// default blue→red ramp (other schemes are selectable from the legend) and of
// the paper ground.
export const PLANNING_BOUNDARY = '#5E554A'; // the 00 outline, dashed and unfilled
export const PLANNING_RESTRICTION_COLORS = ['#7B5EA7', '#4A6A8A', '#B08A2E', '#A4487A', '#5C8C84', '#8A5A3C'];
export const PLANNING_DESIGN = '#2F6B4F'; // the leftover design area
// Dropped GeoJSON files, in drop order. Stronger than the planning colours so
// an ad-hoc layer doesn't get lost among them, and kept off the heatmap's
// default red–yellow–blue ramp.
export const CUSTOM_COLORS = ['#E7298A', '#1B9E77', '#222222', '#7570B3', '#66A61E', '#A6761D'];

// --- expression helpers ----------------------------------------------------
const kind = (...kinds) => ['match', ['get', 'kind'], kinds, true, false];
export const zoom = (...stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];

// --- layer factories -------------------------------------------------------
const fill = (id, layer, color, filter, paint) => ({
	id,
	type: 'fill',
	source: SRC,
	'source-layer': layer,
	...(filter && { filter }),
	paint: { 'fill-color': color, ...paint }
});

const line = (id, filter, color, widths, paint) => ({
	id,
	type: 'line',
	source: SRC,
	'source-layer': 'streets',
	filter,
	paint: { 'line-color': color, 'line-width': zoom(...widths), ...paint }
});

// --- road hierarchy --------------------------------------------------------
// One table drives both the casing and the fill at z16 / z18 / z20.
const ROADS = {
	motorway: { casing: [10, 24, 70], fill: [8, 20, 60] },
	'trunk|primary': { casing: [9, 22, 64], fill: [7, 18, 54] },
	secondary: { casing: [8, 19, 55], fill: [6, 15.5, 46] },
	tertiary: { casing: [7, 17, 48], fill: [5, 13.5, 40] },
	'residential|unclassified|living_street|busway|pedestrian': { casing: [5.5, 14, 40], fill: [4, 11, 33] },
	service: { casing: [3.5, 9, 26], fill: [2.4, 6.5, 20] }
};
const UNCLASSED = { casing: [3, 8, 22], fill: [2, 5.5, 17] };

const roadWidth = (part) => [
	14, part === 'casing' ? 2 : 1,
	...[0, 1, 2].flatMap((i) => [
		[16, 18, 20][i],
		[
			'match',
			['get', 'kind'],
			...Object.entries(ROADS).flatMap(([k, w]) => [k.split('|'), w[part][i]]),
			UNCLASSED[part][i]
		]
	])
];

const DRIVEABLE = [
	'all',
	['!=', ['get', 'rail'], true],
	['match', ['get', 'kind'], ['footway', 'path', 'steps', 'cycleway', 'track', 'runway', 'taxiway'], false, true]
];
const ROUND = { 'line-cap': 'round', 'line-join': 'round' };
const MARKER = ['==', ['get', 'kind'], 'marker'];
const AREA = ['==', ['get', 'kind'], 'area'];

export const customStyle = {
	version: 8,
	name: 'Site Plan',
	glyphs: 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf',
	sources: {
		[SRC]: {
			type: 'vector',
			tiles: ['https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}'],
			minzoom: 0,
			maxzoom: 14,
			attribution: credit('<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>')
		},
		sites: { type: 'geojson', data: SITE_AREAS },
		...IMAGERY
	},
	layers: [
		{ id: 'paper', type: 'background', paint: { 'background-color': PAPER } },

		fill('land-urban', 'land', '#EDE6D8',
			kind('residential', 'commercial', 'retail', 'industrial', 'garages', 'railway',
				'brownfield', 'greenfield', 'farmyard', 'farmland', 'landfill', 'quarry'),
			{ 'fill-antialias': false }),

		fill('land-planting', 'land', '#CBD6BB',
			kind('forest', 'grass', 'meadow', 'park', 'garden', 'village_green', 'recreation_ground',
				'allotments', 'scrub', 'heath', 'grassland', 'orchard', 'vineyard', 'plant_nursery',
				'playground', 'golf_course'),
			{ 'fill-opacity': 0.9 }),

		fill('land-cemetery', 'land', '#D6DAC6', kind('cemetery', 'grave_yard')),
		fill('land-sand', 'land', '#EBE0C6', kind('sand', 'beach', 'bare_rock', 'scree', 'shingle')),
		fill('water', 'water_polygons', '#C2CFD2'),

		{
			id: 'water-lines',
			type: 'line',
			source: SRC,
			'source-layer': 'water_lines',
			filter: ['!=', ['get', 'tunnel'], true],
			paint: { 'line-color': '#C2CFD2', 'line-width': zoom(13, 0.8, 18, 5, 21, 18) }
		},

		fill('site-parking', 'sites', '#E7DDC8', kind('parking', 'bicycle_parking')),
		fill('site-institution', 'sites', '#EDE6D5',
			kind('school', 'university', 'college', 'hospital', 'sports_centre', 'construction', 'prison')),
		fill('paved-area', 'street_polygons', PAVING, kind('pedestrian', 'service'),
			{ 'fill-outline-color': EDGE }),

		{ ...line('street-casing', DRIVEABLE, EDGE, roadWidth('casing')), layout: ROUND },
		{
			...line('street-fill', DRIVEABLE,
				['case', ['==', ['get', 'tunnel'], true], '#EAE2D2', PAVING], roadWidth('fill')),
			layout: ROUND
		},

		{
			...line('path', kind('footway', 'path', 'cycleway', 'track'), '#CFC3AB',
				[15, 0.6, 18, 1.6, 21, 5], { 'line-dasharray': [3, 2] }),
			layout: { 'line-cap': 'butt', 'line-join': 'round' }
		},
		line('steps', ['==', ['get', 'kind'], 'steps'], '#C6BAA1',
			[16, 2, 18, 5, 21, 16], { 'line-dasharray': [0.4, 0.4] }),
		line('rail', ['==', ['get', 'rail'], true], '#D2C7B2',
			[14, 0.6, 18, 2, 21, 6], { 'line-dasharray': [4, 2] }),

		{
			...fill('building', 'buildings', '#ECE5D7', null,
				{ 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.7, 16, 1] }),
			minzoom: 14
		},
		{
			id: 'building-outline',
			type: 'line',
			source: SRC,
			'source-layer': 'buildings',
			minzoom: 14.5,
			layout: { 'line-join': 'round' },
			paint: {
				'line-color': '#CDC1A9',
				'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 15, 0.4, 18, 0.9, 21, 2.4]
			}
		},

		// Aerial imagery covers every basemap layer above when on, but stays below
		// the overlays and the labels. Hidden until the basemap switch asks for it.
		...SATELLITE_LAYERS.map((id) => ({ id, type: 'raster', source: id, layout: { visibility: 'none' } })),

		// --- study area, from the uploaded bbox GeoJSON ---
		// {
		// 	id: 'site-area',
		// 	type: 'fill',
		// 	source: 'sites',
		// 	filter: AREA,
		// 	paint: { 'fill-color': INK, 'fill-opacity': 0.05 }
		// },
		// {
		// 	id: 'site-outline',
		// 	type: 'line',
		// 	source: 'sites',
		// 	filter: AREA,
		// 	layout: { 'line-join': 'miter' },
		// 	paint: {
		// 		'line-color': INK,
		// 		'line-width': zoom(14, 0.8, 18, 1.4, 21, 2.4),
		// 		'line-dasharray': [5, 3]
		// 	}
		// },
		// Ordering anchor for imperatively-added overlays: the heatmap grid inserts
		// below it, the tree crowns above it, so neither can end up on top of the
		// other by winning a race. Renders nothing.
		{ id: 'overlay-anchor', type: 'background', layout: { visibility: 'none' }, paint: { 'background-color': PAPER } },
		// Planning areas insert below this one: above the heatmap, below the tree
		// crowns (which insert before site-marker).
		{ id: 'planning-anchor', type: 'background', layout: { visibility: 'none' }, paint: { 'background-color': PAPER } },

		{
			id: 'site-marker',
			type: 'circle',
			source: 'sites',
			filter: MARKER,
			paint: {
				'circle-radius': zoom(14, 3, 18, 5, 21, 7),
				'circle-color': INK,
				'circle-stroke-color': PAPER,
				'circle-stroke-width': zoom(14, 1.2, 18, 2, 21, 3)
			}
		},
		{
			id: 'site-marker-label',
			type: 'symbol',
			source: 'sites',
			filter: MARKER,
			layout: {
				'text-field': ['get', 'label'],
				'text-font': ['noto_sans_regular'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 20, 13],
				'text-letter-spacing': 0.1,
				'text-offset': [0, -1.1],
				'text-anchor': 'bottom',
				'text-allow-overlap': true,
				'text-rotation-alignment': 'viewport'
			},
			paint: {
				'text-color': INK,
				'text-halo-color': PAPER,
				'text-halo-width': 1.8
			}
		},

		{
			id: 'street-label',
			type: 'symbol',
			source: SRC,
			'source-layer': 'street_labels',
			minzoom: 16,
			filter: ['has', 'name'],
			layout: {
				'symbol-placement': 'line',
				'text-field': ['coalesce', ['get', 'name_de'], ['get', 'name']],
				'text-font': ['noto_sans_regular'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 16, 9.5, 20, 13],
				'text-letter-spacing': 0.06,
				'text-max-angle': 30,
				'text-padding': 4
			},
			paint: { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 1.4 }
		}
	]
};