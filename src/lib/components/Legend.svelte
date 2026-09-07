<script>
	import { interpolateRdYlBu } from 'd3';

	let {
		min, // effective low end of the colour scale (pinned value, or the data's own min); null when nothing is loaded and nothing is pinned
		max, // effective high end, same rules
		pinned = false, // true when either end has been set by hand — enables the reset
		onmin, // called with a number, or null to hand that end back to the data
		onmax,
		onreset
	} = $props();

	const STOPS = 8;
	// A single-value dataset has nothing to ramp across; an absent range just
	// means no data yet, and still shows the full ramp with empty value boxes.
	const flat = $derived(min != null && max != null && max === min);

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

	const fmt = (v) => (v == null ? '' : (Math.round(v * 10) / 10).toFixed(1));

	// Committed on change (blur / Enter / spinner), not on every keystroke, so
	// reformatting the value never fights the caret mid-edit. An emptied field
	// releases that end back to the data range.
	const commit = (handler) => (e) => {
		const raw = e.currentTarget.value.trim();
		const parsed = Number.parseFloat(raw);
		handler?.(raw === '' || !Number.isFinite(parsed) ? null : parsed);
	};
</script>

<div class="legend">
	<span class="label">PET &deg;C</span>
	<input
		class="value"
		type="number"
		step="0.5"
		inputmode="decimal"
		aria-label="Colour scale minimum"
		value={fmt(min)}
		onchange={commit(onmin)}
	/>
	<div class="bar" style:background={gradient}></div>
	<input
		class="value"
		type="number"
		step="0.5"
		inputmode="decimal"
		aria-label="Colour scale maximum"
		value={fmt(max)}
		onchange={commit(onmax)}
	/>
	<button class="reset" disabled={!pinned} onclick={() => onreset?.()}>Auto</button>
</div>

<style>
	.legend {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.8rem;
		font: 400 0.7rem/1.2 ui-sans-serif, system-ui, sans-serif;
		color: #9a9081;
	}

	.label {
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}

	.value {
		width: 3.1rem;
		padding: 0.15rem 0.25rem;
		border: 1px solid transparent;
		border-radius: 1px;
		font: inherit;
		font-variant-numeric: tabular-nums;
		text-align: center;
		color: #6f665a;
		background: #e8e0d0;
		-moz-appearance: textfield;
		appearance: textfield;
	}

	.value::-webkit-outer-spin-button,
	.value::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	.value:hover {
		border-color: #cdc1a9;
	}

	.value:focus {
		outline: none;
		border-color: #9a9081;
		background: #f1ebdf;
	}

	.bar {
		flex: 1;
		min-width: 6rem;
		height: 0.6rem;
		border-radius: 1px;
	}

	.reset {
		margin-left: 0.2rem;
		padding: 0.28rem 0.5rem;
		border: 1px solid #cdc1a9;
		border-radius: 1px;
		font: inherit;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #6f665a;
		background: #f1ebdf;
		cursor: pointer;
	}

	.reset:hover:not(:disabled) {
		color: #f1ebdf;
		background: #9a9081;
		border-color: #9a9081;
	}

	.reset:disabled {
		color: #c3b9a7;
		border-color: #e0d7c5;
		cursor: default;
	}
</style>
