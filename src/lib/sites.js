// Centres taken from the uploaded bbox GeoJSON. The playground can't read local
// files, so the boxes are rebuilt here — same square-metre convention the source
// files used, which means SIZE is the only number to touch.

const SIZE = 100; // metres per side (the GeoJSON files were 300)
const M_PER_DEG = 111320;

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

export const SITES = [
	{
		id: 'dahlbergplatz',
		label: 'Dahlbergplatz',
		note: `Mannheim · ${SIZE} m`,
		center: [8.466304325, 49.486004875], // dahlbergplatz_bbox_300m.geojson
		bearing: 0, // lines the Quadrate grid up with the screen edge
		data: {
			'5m': '/data/5mx5m/dalbergplatz.csv',
			'1m': '/data/1mx1m/dalbergplatz.csv'
		}
	},
	{
		id: 'am-altenhof',
		label: 'Am Altenhof',
		note: `Kaiserslautern · ${SIZE} m`,
		center: [7.76846, 49.44426], // Am_Altenhof_bbox_300m.geojson
		bearing: 0,
		data: {
			'5m': '/data/5mx5m/am_altenhof.csv',
			'1m': '/data/1mx1m/am_altenhof.csv'
		}
	}
].map((site) => ({ ...site, bounds: bbox(site.center) }));

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