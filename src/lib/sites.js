// Site metadata. Each site's real 300 m survey area comes from its own
// GeoJSON at static/geojson/*_bbox_300m.geojson — fetched once, cached, and
// used to find which site a location falls inside. The camera frames a
// tighter SIZE-metre crop around that same site's centre.

// Metres per side for camera framing (the survey areas are 300m). Kept at
// 2 * RADIUS so the clip circle meets the edges of the frame rather than
// floating inside it with a margin of empty basemap — change one and the
// other should follow.
const SIZE = 80;
const M_PER_DEG = 111320;

// Camera framing for a location that falls outside every known survey area —
// wider than SIZE since there's no site geometry to fit the crop to.
export const NO_DATA_SIZE = 300;

// Metres, radius of the radial clip around the visitor. Area — and with it the
// number of cells drawn on every repaint — goes with the square, so this is the
// bluntest lever on draw cost: 40 m instead of 50 m is a third fewer cells.
// It's a content decision first, though: it sets how far around themselves a
// visitor can read the data.
export const RADIUS = 40;

export const frameBbox = ([lng, lat], size = SIZE) => {
	const dy = size / 2 / M_PER_DEG;
	const dx = dy / Math.cos((lat * Math.PI) / 180);
	return [lng - dx, lat - dy, lng + dx, lat + dy]; // [west, south, east, north]
};

// `data` points at the prepared 1x1m grid (EPSG:4326, already reprojected —
// generated from the raw EPSG:25832 CSVs by `npm run prepare:data`, see
// scripts/prepare-data.js).
export const SITES = [
	{
		id: 'dalbergplatz',
		bearing: 0, // lines the Quadrate grid up with the screen edge
		data: '/data/prepared/dalbergplatz.json',
		geojson: '/geojson/dahlbergplatz_bbox_300m.geojson'
	},
	{
		id: 'am-altenhof',
		bearing: 0,
		data: '/data/prepared/am_altenhof.json',
		geojson: '/geojson/Am_Altenhof_bbox_300m.geojson'
	},
	{
		id: 'th-vorplatz',
		bearing: 0,
		data: '/data/prepared/th_vorplatz.json',
		geojson: '/geojson/TH_Vorplatz_bbox_300m.geojson'
	}
];

// Fetched once per site and cached: the real 300 m survey bounds (for
// deciding which site a location falls inside) plus a tighter frame bbox
// around the same centre (for the initial camera).
const geometryCache = new Map();

async function geometryFor(site) {
	if (geometryCache.has(site.id)) return geometryCache.get(site.id);
	const res = await fetch(site.geojson);
	const geojson = await res.json();
	const { properties, geometry } = geojson.features[0];
	const ring = geometry.coordinates[0];
	const lngs = ring.map(([lng]) => lng);
	const lats = ring.map(([, lat]) => lat);
	const entry = {
		surveyBounds: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
		frameBounds: frameBbox(properties.center)
	};
	geometryCache.set(site.id, entry);
	return entry;
}

const inBounds = ([west, south, east, north], lng, lat) =>
	lng >= west && lng <= east && lat >= south && lat <= north;

// Finds whichever site's real (300 m) survey area contains {lng, lat} and
// returns it with its camera-framing bounds attached, or null if the
// location falls outside all three sites.
export async function siteForLocation({ lng, lat }) {
	const geometries = await Promise.all(SITES.map(geometryFor));
	const i = geometries.findIndex((g) => inBounds(g.surveyBounds, lng, lat));
	return i === -1 ? null : { ...SITES[i], bounds: geometries[i].frameBounds };
}
