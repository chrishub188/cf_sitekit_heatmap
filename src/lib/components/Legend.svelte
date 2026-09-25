<script>
	import { COLOR_SCHEMES, rampFor, gradientCss } from '$lib/colorSchemes.js';

	let {
		min, // effective low end of the colour scale (pinned value, or the data's own min); null when nothing is loaded and nothing is pinned
		max, // effective high end, same rules
		pinned = false, // true when either end has been set by hand — enables the reset
		status = null, // 'loading' | 'error' while the grid on screen isn't there yet; shown inside the bar
		statusMessage = null, // why loading failed, shown on hover
		onmin, // called with a number, or null to hand that end back to the data
		onmax,
		onreset,
		scheme, // id of the active colour scheme (see colorSchemes.js)
		reversed = false, // true flips the scheme end to end
		onscheme, // called with a scheme id picked from the popover
		onreverse // called with the new reversed flag
	} = $props();

	const STOPS = 8;
	// A single-value dataset has nothing to ramp across; an absent range just
	// means no data yet, and still shows the full ramp with empty value boxes.
	const flat = $derived(min != null && max != null && max === min);

	// left (0%) = min -> right (100%) = max, the same ramp Heatmap paints with.
	const ramp = $derived(rampFor(scheme, reversed));
	const gradient = $derived(flat ? ramp(0.5) : gradientCss(ramp, STOPS));

	const GROUPS = [
		{ id: 'diverging', label: 'Diverging' },
		{ id: 'sequential', label: 'Sequential' }
	];

	// The scheme picker opens above the bar (the panel sits in the bottom-left
	// corner) and closes on a pick, Escape, or a click anywhere else.
	let open = $state(false);
	/** @type {HTMLElement | undefined} */
	let root = $state();

	const pick = (id) => {
		onscheme?.(id);
		open = false;
	};

	const onWindowPointer = (e) => {
		if (open && root && !root.contains(e.target)) open = false;
	};
	const onWindowKey = (e) => {
		if (open && e.key === 'Escape') open = false;
	};

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

<svelte:window onpointerdown={onWindowPointer} onkeydown={onWindowKey} />

<div class="legend" bind:this={root}>
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
	<!-- The status sits inside the bar rather than beside it, so the panel keeps
	     its width while a grid loads. -->
	<button
		type="button"
		class="bar"
		class:busy={status}
		class:failed={status === 'error'}
		aria-haspopup="true"
		aria-expanded={open}
		aria-label="Change colour scheme"
		title={status === 'error' ? statusMessage : 'Change colour scheme'}
		onclick={() => (open = !open)}
	>
		<span class="ramp" style:background={gradient}></span>
		{#if status}
			<span class="status">{status === 'error' ? 'No data' : 'Loading…'}</span>
		{/if}
	</button>
	{#if open}
		<div class="schemes" role="dialog" aria-label="Colour scheme">
			{#each GROUPS as group (group.id)}
				<div class="group">{group.label}</div>
				{#each COLOR_SCHEMES.filter((s) => s.group === group.id) as s (s.id)}
					<button
						type="button"
						class="scheme"
						class:current={s.id === scheme}
						aria-pressed={s.id === scheme}
						onclick={() => pick(s.id)}
					>
						<span class="swatch" style:background={gradientCss(rampFor(s.id, reversed))}></span>
						<span>{s.label}</span>
					</button>
				{/each}
			{/each}
			<label class="reverse">
				<input type="checkbox" checked={reversed} onchange={(e) => onreverse?.(e.currentTarget.checked)} />
				Reverse
			</label>
		</div>
	{/if}
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
		position: relative;
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
		display: grid;
		flex: 1;
		min-width: 6rem;
		height: 0.6rem;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
	}

	.bar:hover .ramp,
	.bar[aria-expanded='true'] .ramp {
		outline: 1px solid #cdc1a9;
		outline-offset: 2px;
	}

	/* Spans the control panel's full outer width (the legend is its first row,
	   inside a 2px border) and sits one corner-stack gap above it, so it cleanly
	   covers whatever is stacked there rather than half-overlapping it. */
	.schemes {
		position: absolute;
		bottom: calc(100% + 2px + 0.4rem);
		left: -2px;
		right: -2px;
		z-index: 10;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.1rem 0.4rem;
		max-height: 60vh;
		overflow-y: auto;
		padding: 0.4rem;
		border: 2px solid #cdc1a9;
		background: #f1ebdf;
	}

	.group,
	.reverse {
		grid-column: 1 / -1;
	}

	.group {
		padding: 0.3rem 0.3rem 0.15rem;
		font-size: 0.6rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}

	.scheme {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.3rem;
		border: 1px solid transparent;
		border-radius: 1px;
		font: inherit;
		text-align: left;
		color: #6f665a;
		background: none;
		cursor: pointer;
	}

	.scheme:hover {
		background: #e8e0d0;
	}

	.scheme.current {
		border-color: #9a9081;
		background: #e8e0d0;
	}

	.swatch {
		flex: none;
		width: 3rem;
		height: 0.6rem;
		border-radius: 1px;
	}

	.reverse {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.3rem;
		padding: 0.4rem 0.3rem 0.1rem;
		border-top: 1px solid #cdc1a9;
		color: #6f665a;
		cursor: pointer;
	}

	.reverse input {
		margin: 0;
		accent-color: #9a9081;
	}

	.bar > * {
		grid-area: 1 / 1;
	}

	.ramp {
		border-radius: 1px;
	}

	.busy .ramp {
		opacity: 0.25;
	}

	.status {
		place-self: center;
		font-size: 0.6rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #6f665a;
	}

	.failed .status {
		color: #a2503f;
	}

	.busy:not(.failed) .status {
		animation: pulse 1.2s ease-in-out infinite alternate;
	}

	@keyframes pulse {
		from {
			opacity: 0.45;
		}
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
