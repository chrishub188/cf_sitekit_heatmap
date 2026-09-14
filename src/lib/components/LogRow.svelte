<script>
	import SegmentedSwitch from '$lib/components/SegmentedSwitch.svelte';
	import { OVERLAY_MODES } from '$lib/sites.js';

	let {
		name = null, // filename of the loaded log
		count = 0, // interventions parsed
		shown = 0, // how many survived the active clip shape
		entries = 0, // records in the log; only worth showing when there's more than one
		error = null, // parse or read failure; replaces the controls
		simulation = null, // 'loading' | 'ready' | 'error' — the recalculated heatmap for the site on screen
		simulationError = null, // why the recalculation failed, shown on hover
		mode = 'heatmap',
		onmode,
		onfile, // (File) => void, from the picker
		onclear
	} = $props();

	/** @type {HTMLInputElement} */
	let picker;

	// Clipped-away trees would otherwise read as a bug, so say so whenever the
	// shape on screen is hiding some.
	const tally = $derived(shown < count ? `${shown} of ${count} trees` : `${count} trees`);
	const meta = $derived(entries > 1 ? `${entries} entries · ${tally}` : tally);
	// Says which heatmap is on screen: while loading or after a failure it is
	// still the static data, which would otherwise pass for the simulated one.
	/** @type {Record<string, string>} */
	const SIMULATION_LABELS = {
		loading: 'Simulating…',
		ready: 'Simulated',
		error: 'Static · sim failed'
	};

	function pick(e) {
		const [file] = e.currentTarget.files ?? [];
		// Cleared so picking the same file twice still fires a change event.
		e.currentTarget.value = '';
		if (file) onfile?.(file);
	}
</script>

<div class="row">
	{#if error}
		<p class="error">{error}</p>
	{:else if name}
		<SegmentedSwitch options={OVERLAY_MODES} active={mode} onselect={onmode} />
		{#if simulation}
			<span
				class="sim"
				class:failed={simulation === 'error'}
				title={simulation === 'error' ? simulationError : null}>{SIMULATION_LABELS[simulation]}</span
			>
		{/if}
		<span class="meta" title={name}>{meta} · {name}</span>
	{:else}
		<!-- No log yet: the row is the affordance, since drag and drop alone
		     leaves nothing to discover. -->
		<button class="load" onclick={() => picker.click()}>+ Load logfile</button>
	{/if}

	{#if name || error}
		<button class="clear" aria-label="Clear log" onclick={() => onclear?.()}>✕</button>
	{/if}
</div>

<!-- No `accept`: logs come with no agreed extension, and a filter would hide them. -->
<input bind:this={picker} type="file" onchange={pick} hidden />

<style>
	.row {
		display: flex;
		align-items: center;
	}

	.meta,
	.sim,
	.error,
	.load,
	.clear {
		padding: 0.5rem 0.9rem;
		font: 400 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #9a9081;
	}

	.error,
	.meta {
		margin: 0;
		white-space: nowrap;
	}

	.error,
	.sim.failed {
		color: #a2503f;
	}

	/* Sits between the switch and the tally; the tally's own left padding is
	   the gap, so this one only needs padding on the switch side. */
	.sim {
		padding-right: 0;
		white-space: nowrap;
	}

	/* The panel is width:fit-content, so an unbounded filename would widen the
	   whole box and reflow the legend gradient above it. */
	.meta {
		overflow: hidden;
		max-width: 12rem;
		text-overflow: ellipsis;
	}

	.load,
	.clear {
		border: 0;
		background: none;
		cursor: pointer;
	}

	.load {
		flex: 1;
		text-align: left;
	}

	.load:hover,
	.clear:hover {
		color: #6f665a;
	}

	.clear {
		margin-left: auto;
	}
</style>
