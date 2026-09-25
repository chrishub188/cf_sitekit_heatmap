<script>
	import { planningLayers } from '$lib/planning.js';
	import DropHint from '$lib/components/DropHint.svelte';

	let {
		site, // the site on screen; its own files make up the list
		enabled = new Set(), // ids of the layers switched on
		custom = [], // dropped GeoJSON files (see customLayer); shown on every site
		error = null, // why the last dropped GeoJSON was rejected
		open = $bindable(false), // starts collapsed; the page opens it on a drop
		ontoggle, // (id, on) => void
		onremove, // (id) => void, for a dropped file
		onfile // (File) => void, from the import picker
	} = $props();

	/** @type {HTMLInputElement} */
	let picker;

	/** @param {Event & { currentTarget: HTMLInputElement }} e */
	function pick(e) {
		const [file] = e.currentTarget.files ?? [];
		// Cleared so picking the same file twice still fires a change event.
		e.currentTarget.value = '';
		if (file) onfile?.(file);
	}

	const layers = $derived(planningLayers(site));
	const restrictions = $derived(layers.filter((l) => l.group === 'restriction'));
	const design = $derived(layers.filter((l) => l.group === 'design'));
	const count = $derived([...layers, ...custom].filter((l) => enabled.has(l.id)).length);
</script>

<!-- Never disabled: even a site without planning files opens, for the import row. -->
<div class="panel">
	<button class="header" aria-expanded={open} onclick={() => (open = !open)}>
		<!-- Title first, so it lines up with the "+" rows; the chevron sits at the end. -->
		<span class="title">Planning areas</span>
		{#if count}
			<span class="note">{count} on</span>
		{:else if layers.length === 0}
			<span class="note">no site data</span>
		{/if}
		<!-- Drawn, not a ▸ glyph: at this size the system font renders it as a dot. -->
		<svg class="caret" class:open viewBox="0 0 16 16" aria-hidden="true">
			<path d="M6 3.5 10.5 8 6 12.5" />
		</svg>
	</button>

	{#if open}
		{#if restrictions.length}
			<div class="group">
				{#each restrictions as layer (layer.id)}
					{@render row(layer)}
				{/each}
			</div>
		{/if}
		{#if design.length}
			<div class="group">
				<p class="sub">Design</p>
				{#each design as layer (layer.id)}
					{@render row(layer)}
				{/each}
			</div>
		{/if}
		{#if custom.length || error}
			<div class="group">
				<p class="sub">Imported</p>
				{#each custom as layer (layer.id)}
					<div class="removable">
						{@render row(layer)}
						<button class="remove" aria-label="Remove {layer.label}" onclick={() => onremove?.(layer.id)}
							>✕</button
						>
					</div>
				{/each}
				{#if error}
					<p class="error">{error}</p>
				{/if}
			</div>
		{/if}
		<!-- Last in the list, under whatever it has already imported. -->
		<div class="import">
			<button class="load" onclick={() => picker.click()}>+ Import GeoJSON</button>
			<DropHint title="Drag a .geojson file anywhere onto the map" />
		</div>
	{/if}
</div>

<input
	bind:this={picker}
	type="file"
	accept=".geojson,.json,application/geo+json,application/json"
	onchange={pick}
	hidden
/>

{#snippet row(layer)}
	<label title={layer.label}>
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
		<span class="name">{layer.label}</span>
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
		padding: 0.5rem 0.9rem;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}

	.header:hover {
		color: #6f665a;
	}

	.title {
		flex: 1;
	}

	/* Points down when closed (opens below), up when open. */
	.caret {
		flex: none;
		width: 0.8rem;
		height: 0.8rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
		transform: rotate(90deg);
		transition: transform 0.15s;
	}

	.caret.open {
		transform: rotate(-90deg);
	}

	.note {
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
		padding: 0.4rem 0.9rem 0.1rem;
		font-size: 0.62rem;
		color: #b3a891;
	}

	label {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.35rem 0.9rem;
		cursor: pointer;
	}

	label:hover {
		color: #6f665a;
	}

	/* Same look as "+ Load logfile" in the control panel below. */
	.import {
		display: flex;
		align-items: center;
		border-top: 1px solid #cdc1a9;
	}

	/* Same padding as LogRow's .load, so the two "+" rows line up. */
	.load {
		flex: 1;
		padding: 0.5rem 0.9rem;
		border: 0;
		font: 400 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
		white-space: nowrap;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		text-align: left;
		color: #9a9081;
		background: none;
		cursor: pointer;
	}

	.load:hover {
		color: #6f665a;
	}

	/* A dropped file can have any name; cut it short rather than widen the corner. */
	.name {
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* A dropped file's row: the label takes the width, the ✕ sits at the end. */
	.removable {
		display: flex;
		align-items: center;
	}

	.removable label {
		flex: 1;
		min-width: 0;
	}

	.remove {
		padding: 0.35rem 0.9rem;
		border: 0;
		font: 400 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
		color: #b3a891;
		background: none;
		cursor: pointer;
	}

	.remove:hover {
		color: #6f665a;
	}

	.error {
		margin: 0;
		padding: 0.35rem 0.9rem;
		max-width: 22rem;
		font: 400 0.68rem/1.3 ui-sans-serif, system-ui, sans-serif;
		color: #a4487a;
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
