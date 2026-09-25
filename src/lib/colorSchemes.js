// Colour schemes selectable from the legend. All come from d3-scale-chromatic
// (the same set Vega and Observable list), normalised so t=0 is the low (cool)
// end of the PET range and t=1 the high (hot) end. `invert` flags the ones whose
// native d3 direction runs the other way, e.g. the diverging ramps start at red.

import {
	interpolateRdYlBu,
	interpolateRdBu,
	interpolateSpectral,
	interpolatePuOr,
	interpolateYlOrRd,
	interpolateOrRd,
	interpolateInferno,
	interpolateMagma,
	interpolatePlasma,
	interpolateViridis,
	interpolateCividis,
	interpolateTurbo,
	interpolateWarm
} from 'd3';

/** @typedef {(t: number) => string} Ramp */
/** @typedef {{ id: string, label: string, group: 'diverging' | 'sequential', interpolate: Ramp, invert: boolean }} ColorScheme */

/** @type {ColorScheme[]} */
export const COLOR_SCHEMES = [
	{ id: 'RdYlBu', label: 'Red–Yellow–Blue', group: 'diverging', interpolate: interpolateRdYlBu, invert: true },
	{ id: 'RdBu', label: 'Red–Blue', group: 'diverging', interpolate: interpolateRdBu, invert: true },
	{ id: 'Spectral', label: 'Spectral', group: 'diverging', interpolate: interpolateSpectral, invert: true },
	{ id: 'PuOr', label: 'Purple–Orange', group: 'diverging', interpolate: interpolatePuOr, invert: false },
	{ id: 'YlOrRd', label: 'Yellow–Orange–Red', group: 'sequential', interpolate: interpolateYlOrRd, invert: false },
	{ id: 'OrRd', label: 'Orange–Red', group: 'sequential', interpolate: interpolateOrRd, invert: false },
	{ id: 'Inferno', label: 'Inferno', group: 'sequential', interpolate: interpolateInferno, invert: false },
	{ id: 'Magma', label: 'Magma', group: 'sequential', interpolate: interpolateMagma, invert: false },
	{ id: 'Plasma', label: 'Plasma', group: 'sequential', interpolate: interpolatePlasma, invert: false },
	{ id: 'Viridis', label: 'Viridis', group: 'sequential', interpolate: interpolateViridis, invert: false },
	{ id: 'Cividis', label: 'Cividis', group: 'sequential', interpolate: interpolateCividis, invert: false },
	{ id: 'Turbo', label: 'Turbo', group: 'sequential', interpolate: interpolateTurbo, invert: false },
	{ id: 'Warm', label: 'Warm', group: 'sequential', interpolate: interpolateWarm, invert: false }
];

export const DEFAULT_SCHEME = 'RdYlBu';

const byId = new Map(COLOR_SCHEMES.map((s) => [s.id, s]));

/** @param {unknown} id */
export const isScheme = (id) => typeof id === 'string' && byId.has(id);

// A t -> colour function running low -> high PET; `reversed` flips it on top
// of the scheme's own normalisation.
/** @param {string} id @param {boolean} [reversed] @returns {Ramp} */
export function rampFor(id, reversed = false) {
	const { interpolate, invert } = byId.get(id) ?? /** @type {ColorScheme} */ (byId.get(DEFAULT_SCHEME));
	return invert !== reversed ? (t) => interpolate(1 - t) : interpolate;
}

// CSS gradient of a ramp, left = low, right = high.
/** @param {Ramp} ramp @param {number} [stops] */
export function gradientCss(ramp, stops = 8) {
	return `linear-gradient(to right, ${Array.from(
		{ length: stops + 1 },
		(_, i) => `${ramp(i / stops)} ${(i / stops) * 100}%`
	).join(', ')})`;
}
