// Centres taken from the uploaded bbox GeoJSON. The playground can't read local
// files, so the boxes are rebuilt here — same square-metre convention the source
// files used, which means SIZE and FULL_SIZE are the only numbers to touch.

import { haversine, M_PER_DEG } from '$lib/geo.js';

const SIZE = 100; // metres per side, the default close-up crop
const FULL_SIZE = 300; // metres per side, the full extent the source CSVs cover
export const RADIUS = 50; // metres, for the circular clip shape

/** @param {number[]} center @param {number} [size] @returns {number[]} */
const bbox = ([lng, lat], size = SIZE) => {
	const dy = size / 2 / M_PER_DEG;
	const dx = dy / Math.cos((lat * Math.PI) / 180);
	return [lng - dx, lat - dy, lng + dx, lat + dy]; // [west, south, east, north]
};

// Two grid resolutions ship side by side under static/data/<id>/. The 5 m set
// is already in lon/lat (EPSG:4326); the 1 m set is projected (EPSG:25832)
// and needs reprojecting client-side — see Heatmap's `crs` prop.
export const RESOLUTIONS = [
	{ id: '5m', label: '5 m', crs: 'wgs84' },
	{ id: '1m', label: '1 m', crs: 'epsg25832' }
];

// Four ways to clip the data to a site: the square bbox (SIZE above), the full
// extent the CSVs cover (FULL_SIZE), the hand-traced plaza outline shipped per
// site under filter_location/, or a RADIUS-metre circle around the centre
// point. The two rectangles sit next to each other so they read as a pair.
export const CLIP_SHAPES = [
	{ id: 'square', label: `${SIZE} m` },
	{ id: 'full', label: `${FULL_SIZE} m` },
	{ id: 'plaza', label: 'Plaza' },
	{ id: 'circle', label: `Ø ${RADIUS} m` }
];

// What the map is currently showing. A dropped logfile adds 'trees'; with no
// log loaded the switch isn't rendered and the heatmap is the only mode.
export const OVERLAY_MODES = [
	{ id: 'heatmap', label: 'Heatmap' },
	{ id: 'trees', label: 'Trees' }
];

export const SITES = [
	{
		id: 'dalbergplatz',
		label: 'Dalbergplatz',
		note: `Mannheim · ${FULL_SIZE} m`,
		center: [8.466304325, 49.486004875], // dahlbergplatz_bbox_300m.geojson
		bearing: 0, // lines the Quadrate grid up with the screen edge
		filterUrl: '/geojson/filter_location/dalbergplatz.geojson',
		data: {
			'5m': '/data/5mx5m/dalbergplatz.csv',
			'1m': '/data/1mx1m/dalbergplatz.csv'
		}
	},
	{
		id: 'am-altenhof',
		label: 'Am Altenhof',
		note: `Kaiserslautern · ${FULL_SIZE} m`,
		center: [7.76846, 49.44426], // Am_Altenhof_bbox_300m.geojson
		bearing: 0,
		filterUrl: '/geojson/filter_location/am_altenhof.geojson',
		data: {
			'5m': '/data/5mx5m/am_altenhof.csv',
			'1m': '/data/1mx1m/am_altenhof.csv'
		}
	},
	{
		id: 'th-vorplatz',
		label: 'TH-Vorplatz',
		note: `Mannheim · ${FULL_SIZE} m`,
		center: [8.483312, 49.469456], // TH_Vorplatz_bbox_300m.geojson
		bearing: 0,
		filterUrl: '/geojson/filter_location/th_vorplatz.geojson',
		data: {
			'5m': '/data/5mx5m/th_vorplatz.csv',
			'1m': '/data/1mx1m/th_vorplatz.csv'
		}
	}
].map((site) => ({
	...site,
	bounds: bbox(site.center),
	fullBounds: bbox(site.center, FULL_SIZE)
}));

// One collection carrying both the study-area rectangles and their centre
// points; the style picks them apart with a `kind` filter.
const polygon = ([w, s, e, n] /* bounds */) => ({
	type: 'Polygon',
	coordinates: [[[w, n], [e, n], [e, s], [w, s], [w, n]]]
});

export const SITE_AREAS = {
	type: 'FeatureCollection',
	features: SITES.flatMap(({ id, label, center, bounds }) => [
		{
			type: 'Feature',
			properties: { id, label, kind: 'area', size_m: SIZE },
			geometry: polygon(bounds)
		},
		{
			type: 'Feature',
			properties: { id, label, kind: 'marker' },
			geometry: { type: 'Point', coordinates: center }
		}
	])
};

// A logfile carries its own centre, but the app only ever frames the three
// sites above — so a log is adopted by the nearest one and rejected if it
// belongs to none, rather than flying the camera somewhere with no data.
export const SITE_MATCH_M = 150; // metres; half the width of the widest crop

/** @param {number[]} center @param {number} [maxMeters] @returns {{ index: number, distance: number } | null} */
export function nearestSite([lng, lat], maxMeters = SITE_MATCH_M) {
	/** @type {{ index: number, distance: number } | null} */
	let best = null;
	for (const [index, site] of SITES.entries()) {
		const distance = haversine(lng, lat, site.center[0], site.center[1]);
		if (!best || distance < best.distance) best = { index, distance };
	}
	return best && best.distance <= maxMeters ? best : null;
}
