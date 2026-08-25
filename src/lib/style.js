// Custom map style for the Shortbread 1.0 schema served by VersaTiles.
// Warm paper site plan: cream ground, tan paving, hairline buildings, sage planting.

const SRC = 'versatiles-shortbread';

const PAPER = '#F1EBDF';
const PAVING = '#E5DBC7';
const EDGE = '#D5C9B1';
const INK = '#9A9081';

// --- expression helpers ----------------------------------------------------
const kind = (...kinds) => ['match', ['get', 'kind'], kinds, true, false];
const zoom = (...stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];

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
			attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>'
		}
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