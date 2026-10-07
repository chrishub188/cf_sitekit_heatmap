import { loadPlanningLayer, planningLayers } from '$lib/planning.js';

// The interventions a user can drag onto the map, and the crown shape every
// tree is drawn with. The backend tells the types apart by name only; the
// radius is what the map draws, not something sent with the request.

/**
 * @typedef {{ id: string, label: string, radius: number, icon: number }} InterventionType
 */

/** @type {InterventionType[]} */
export const INTERVENTION_TYPES = [
	// icon: how large the crown is drawn in the palette, in px
	{ id: 'TREE_SMALL', label: 'Small tree', radius: 3.25, icon: 22 },
	{ id: 'TREE_LARGE', label: 'Large tree', radius: 15, icon: 34 }
];

const byId = new Map(INTERVENTION_TYPES.map((t) => [t.id, t]));

/** @param {string} id */
export const interventionType = (id) => byId.get(id) ?? null;

// Crown radius in metres. A type the app doesn't know (an older log, say) is
// drawn at the small tree's size, which is what every tree used to be.
/** @param {string} type */
export const crownRadius = (type) => byId.get(type)?.radius ?? INTERVENTION_TYPES[0].radius;

// The cloud-shaped crown outline, as [x, y] with +y north and the outermost
// lobe at distance 1 from the centre, so scaling by the crown radius gives the
// tree's real extent. Sampled from the 44×44 SVG crown path
//   M22.87 4.67A5.88 5.88 0 0 1 32.26 8A6.72 … A6.97 6.97 0 0 1 22.87 4.67Z
// at 7 points per arc. Clockwise, so a line's left side is the outside.
/** @type {[number, number][]} */
export const CROWN_SHAPE = [
	[0.044, 0.885], [0.119, 0.929], [0.203, 0.949], [0.29, 0.944], [0.371, 0.915], [0.441, 0.865],
	[0.493, 0.796], [0.524, 0.715], [0.622, 0.705], [0.714, 0.668], [0.79, 0.606], [0.846, 0.524],
	[0.877, 0.43], [0.88, 0.332], [0.854, 0.236], [0.914, 0.187], [0.957, 0.122], [0.98, 0.047],
	[0.981, -0.031], [0.959, -0.106], [0.917, -0.172], [0.858, -0.223], [0.885, -0.312], [0.886, -0.405],
	[0.86, -0.495], [0.81, -0.573], [0.739, -0.634], [0.654, -0.673], [0.562, -0.685], [0.53, -0.776],
	[0.473, -0.853], [0.396, -0.912], [0.306, -0.946], [0.211, -0.953], [0.117, -0.932], [0.033, -0.886],
	[-0.056, -0.94], [-0.156, -0.967], [-0.26, -0.964], [-0.359, -0.932], [-0.444, -0.873], [-0.509, -0.792],
	[-0.549, -0.696], [-0.628, -0.691], [-0.702, -0.663], [-0.765, -0.616], [-0.812, -0.552], [-0.839, -0.477],
	[-0.844, -0.398], [-0.826, -0.321], [-0.908, -0.253], [-0.967, -0.165], [-0.998, -0.064], [-0.999, 0.043],
	[-0.97, 0.145], [-0.913, 0.234], [-0.833, 0.304], [-0.852, 0.387], [-0.847, 0.473], [-0.817, 0.553],
	[-0.767, 0.622], [-0.698, 0.673], [-0.618, 0.703], [-0.533, 0.708], [-0.492, 0.803], [-0.426, 0.881],
	[-0.341, 0.938], [-0.243, 0.968], [-0.14, 0.969], [-0.042, 0.941]
];

// The same outline as an SVG path in a 44×44 box (centre 22,22, radius 20),
// for the palette and the drag icon, so what's dragged looks like what lands.
export const CROWN_PATH =
	'M' + CROWN_SHAPE.map(([x, y]) => `${(22 + x * 20).toFixed(2)} ${(22 - y * 20).toFixed(2)}`).join('L') + 'Z';

// Where a site lets trees be placed: its Entwurfsfläche (the planning layer in
// the 'design' group), in lon/lat. Null means no restriction, for a site that
// ships no design area (TH-Vorplatz). A design file that fails to load gives
// an empty zone rather than null, so a network hiccup blocks placing instead
// of silently lifting the restriction; loadPlanningLayer retries next time.
/** @param {Parameters<typeof planningLayers>[0]} site @returns {Promise<{ features: any[] } | null>} */
export async function loadPlacementZone(site) {
	const design = planningLayers(site).find((l) => l.group === 'design');
	if (!design) return null;
	return { features: (await loadPlanningLayer(design.url)) ?? [] };
}
