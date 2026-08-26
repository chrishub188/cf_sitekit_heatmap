// Coalesces bursts of calls (e.g. high-frequency postMessage updates) down to
// at most one call per animation frame, always using the most recent args.
/**
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @returns {F}
 */
export function rafThrottle(fn) {
	let scheduled = false;
	/** @type {any[]} */
	let latestArgs = [];
	return /** @type {F} */ (
		(...args) => {
			latestArgs = args;
			if (scheduled) return;
			scheduled = true;
			requestAnimationFrame(() => {
				scheduled = false;
				fn(...latestArgs);
			});
		}
	);
}
