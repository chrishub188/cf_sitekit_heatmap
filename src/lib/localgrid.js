// The 5 m heatmap. Unlike 1 m, which comes from the simulation backend, 5 m
// is a separate model run shipped as static CSVs (static/data/5mx5m/). Its
// cells are modelled at 5 m, so they're drawn as they are rather than averaged
// down from the 1 m grid. Not every site has one — see `grid5mUrl` in sites.js.
//
// Columns: x,y,pet,t,ntzg,hour — x/y are the cell centre in lon/lat, which
// lands on a whole 5 m multiple once reprojected to EPSG:25832.

import proj4 from 'proj4';
import { EPSG25832 } from '$lib/geo.js';

export const LOCAL_PITCH = 5; // metres

/** @typedef {{ rows: { x: number, y: number, pet: number }[], pitch: number }} GridRows */

/** @param {string} text @returns {GridRows} */
function parseCsv(text) {
	const [header, ...lines] = text.trim().split(/\r?\n/);
	const cols = header.split(',').map((c) => c.trim());
	const [ix, iy, ipet] = ['x', 'y', 'pet'].map((c) => cols.indexOf(c));
	if (ix < 0 || iy < 0 || ipet < 0) throw new Error('CSV needs x, y and pet columns');

	const rows = [];
	for (const line of lines) {
		const f = line.split(',');
		const lon = Number(f[ix]);
		const lat = Number(f[iy]);
		if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
		// Same row shape gridToRows produces: UTM metres, NaN for a cell with no
		// value, which the Heatmap draws as filtered.
		const [x, y] = proj4('WGS84', EPSG25832, [lon, lat]);
		const pet = f[ipet] === '' ? NaN : Number(f[ipet]);
		rows.push({ x, y, pet });
	}
	return { rows, pitch: LOCAL_PITCH };
}

// Fetched once per URL; a failure is dropped so the next visit retries.
/** @type {Map<string, Promise<GridRows>>} */
const cache = new Map();

/** @param {string} url @returns {Promise<GridRows>} */
export function loadLocalGrid(url) {
	let pending = cache.get(url);
	if (!pending) {
		pending = fetch(url)
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.text();
			})
			.then(parseCsv);
		pending.catch(() => cache.delete(url));
		cache.set(url, pending);
	}
	return pending;
}
