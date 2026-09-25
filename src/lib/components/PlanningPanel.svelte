<script>
	import { planningLayers } from '$lib/planning.js';

	let {
		site, // the site on screen; its own files make up the list
		enabled = new Set(), // ids of the layers switched on
		ontoggle // (id, on) => void
	} = $props();

	// Starts collapsed so the corner stays as compact as before until asked.
	let open = $state(false);

	const layers = $derived(planningLayers(site));
	const restrictions = $derived(layers.filter((l) => l.group === 'restriction'));
	const design = $derived(layers.filter((l) => l.group === 'design'));
	const count = $derived(layers.filter((l) => enabled.has(l.id)).length);
	const empty = $derived(layers.length === 0);
</script>

<div class="panel">
	<button class="header" disabled={empty} aria-expanded={open && !empty} onclick={() => (open = !open)}>
		<span class="caret" class:open={open && !empty}>▸</span>
		Planning areas
		{#if empty}
			<span class="note">no data</span>
		{:else if count}
			<span class="note">{count} on</span>
		{/if}
	</button>

	{#if open && !empty}
		<div class="group">
			{#each restrictions as layer (layer.id)}
				{@render row(layer)}
			{/each}
		</div>
		{#if design.length}
			<div class="group">
				<p class="sub">Design</p>
				{#each design as layer (layer.id)}
					{@render row(layer)}
				{/each}
			</div>
		{/if}
	{/if}
</div>

{#snippet row(layer)}
	<label title={layer.id}>
		<input
			type="checkbox"
			checked={enabled.has(layer.id)}
			onchange={(e) => ontoggle?.(layer.id, e.currentTarget.checked)}
		/>
		<span
			class="swatch"
			class:dashed={layer.dashed}
			style:--color={layer.color}
			style:--fill={layer.fillOpacity}
		></span>
		{layer.label}
	</label>
{/snippet}

<style>
	.panel {
		border: 2px solid #cdc1a9;
		background: #f1ebdf;
	}

	.header,
	label,
	.sub {
		font: 400 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
		white-space: nowrap;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #9a9081;
	}

	.header {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		padding: 0.5rem 0.7rem;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}

	.header:hover:not(:disabled) {
		color: #6f665a;
	}

	.header:disabled {
		color: #cdc1a9;
		cursor: default;
	}

	.caret {
		display: inline-block;
		width: 0.85rem;
		text-align: center;
		transition: transform 0.15s;
	}

	.caret.open {
		transform: rotate(90deg);
	}

	.note {
		margin-left: auto;
		text-transform: none;
		letter-spacing: 0.04em;
	}

	/* Same hairline as between the rows of the control panel below. */
	.group {
		border-top: 1px solid #cdc1a9;
		padding-block: 0.15rem;
	}

	.sub {
		margin: 0;
		padding: 0.4rem 0.7rem 0.1rem;
		font-size: 0.62rem;
		color: #b3a891;
	}

	label {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.35rem 0.7rem;
		cursor: pointer;
	}

	label:hover {
		color: #6f665a;
	}

	input {
		width: 0.85rem;
		height: 0.85rem;
		margin: 0;
		accent-color: #9a9081;
		cursor: pointer;
	}

	/* Border in the line colour over a tint of the fill, as drawn on the map. */
	.swatch {
		position: relative;
		flex: none;
		width: 0.7rem;
		height: 0.7rem;
		border: 1.5px solid var(--color);
		border-radius: 2px;
		box-sizing: border-box;
	}

	.swatch::before {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--color);
		opacity: max(var(--fill), 0.18);
	}

	.swatch.dashed {
		border-style: dashed;
	}

	.swatch.dashed::before {
		opacity: 0;
	}
</style>
