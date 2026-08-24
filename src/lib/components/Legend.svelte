<script>
	import { interpolateRdYlBu } from 'd3';

	let { min, max } = $props();

	const STOPS = 8;
	const flat = $derived(max === min);

	// left (0%) = t=1 (blue, min) -> right (100%) = t=0 (red, max), mirroring
	// the reversed domain Heatmap fits its color scale to.
	const gradient = $derived(
		flat
			? interpolateRdYlBu(0.5)
			: `linear-gradient(to right, ${Array.from({ length: STOPS + 1 }, (_, i) => {
					const t = 1 - i / STOPS;
					return `${interpolateRdYlBu(t)} ${(i / STOPS) * 100}%`;
				}).join(', ')})`
	);

	const fmt = (v) => (Math.round(v * 10) / 10).toFixed(1);
</script>

<div class="legend">
	<span class="label">PET</span>
	<span class="value">{fmt(min)}</span>
	<div class="bar" style:background={gradient}></div>
	<span class="value">{fmt(max)}&deg;</span>
</div>

<style>
	.legend {
		position: absolute;
		/* clears MapLibre's own bottom-right scale + attribution controls */
		bottom: 5.8rem;
		left: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.8rem;
		border: 1px solid #cdc1a9;
		background: #f1ebdf;
		font: 400 0.7rem/1.2 ui-sans-serif, system-ui, sans-serif;
		color: #9a9081;
	}

	.label {
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}

	.value {
		font-variant-numeric: tabular-nums;
		color: #6f665a;
	}

	.bar {
		width: 4.5rem;
		height: 0.4rem;
		border-radius: 1px;
	}
</style>
