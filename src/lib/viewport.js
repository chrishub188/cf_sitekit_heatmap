// How much of the world is on screen, and how much of it carries data.
//
// This was sites.js. The three pre-surveyed areas it used to configure are
// gone along with the static grid mode: the EnvGrid service answers anywhere
// the visitor stands, so nothing needs to know which rectangle they are
// standing in. The surveys themselves survive only as raw CSVs under
// rawdata/1mx1m/, which scripts/check-grid-orientation.js reads from disk to
// score the service against — both untracked, and needed by neither the build
// nor the app.

const M_PER_DEG = 111320;

// Metres per side for camera framing. Kept at 2 * RADIUS so the clip circle
// meets the edges of the frame rather than floating inside it with a margin of
// empty basemap — change one and the other should follow.
export const SIZE = 80;

// Metres, radius of the radial clip around the visitor. Area — and with it the
// number of cells drawn on every repaint — goes with the square, so this is the
// bluntest lever on draw cost: 40 m instead of 50 m is a third fewer cells.
// It's a content decision first, though: it sets how far around themselves a
// visitor can read the data.
export const RADIUS = 40;

/**
 * The [west, south, east, north] box of a `size`-metre square centred on a point.
 * @param {[number, number]} center
 * @param {number} [size]
 */
export const frameBbox = ([lng, lat], size = SIZE) => {
	const dy = size / 2 / M_PER_DEG;
	const dx = dy / Math.cos((lat * Math.PI) / 180);
	return [lng - dx, lat - dy, lng + dx, lat + dy];
};
