// Site metadata. Each site's real 300 m survey area comes from its own
// GeoJSON at static/geojson/*_bbox_300m.geojson — fetched once, cached, and
// used to find which site a location falls inside. The camera frames a
// tighter SIZE-metre crop around that same site's centre.

const SIZE = 100; // metres per side for camera framing (the survey areas are 300m)
const M_PER_DEG = 111320;

export const RADIUS = 50; // metres, radius of the radial clip around a site's centre

const frameBbox = ([lng, lat], size = SIZE) => {
	const dy = size / 2 / M_PER_DEG;
	const dx = dy / Math.cos((lat * Math.PI) / 180);
	return [lng - dx, lat - dy, lng + dx, lat + dy]; // [west, south, east, north]
};

// 1x1m grid CSVs (EPSG:25832, reprojected client-side — see Heatmap.svelte).
export const SITES = [
	{
		id: 'dalbergplatz',
		bearing: 0, // lines the Quadrate grid up with the screen edge
		data: '/data/1mx1m/dalbergplatz.csv',
		geojson: '/geojson/dahlbergplatz_bbox_300m.geojson'
	},
	{
		id: 'am-altenhof',
		bearing: 0,
		data: '/data/1mx1m/am_altenhof.csv',
		geojson: '/geojson/Am_Altenhof_bbox_300m.geojson'
	},
	{
		id: 'th-vorplatz',
		bearing: 0,
		data: '/data/1mx1m/th_vorplatz.csv',
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
