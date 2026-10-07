<script>
	// A slim column on the right edge: one tile per intervention type to drag
	// onto the map, then Undo and Clear for what's been placed. The right edge
	// is the one side with nothing stacked along it, so the column can't run
	// into the planning panel the way it did on the left. Dragging itself is
	// PlacementLayer's job; a tile only reports where the gesture started.
	import CrownIcon from '$lib/components/CrownIcon.svelte';
	import { INTERVENTION_TYPES } from '$lib/interventions.js';

	let {
		count = 0, // trees placed by hand on the site on screen
		canUndo = false,
		removing = false, // a placed tree is being dragged: the strip is where it goes to be removed
		treesShown = true, // whether the crowns are drawn over the heatmap
		onpick, // (typeId, PointerEvent) => void
		onundo,
		onclear,
		ontoggletrees // () => void
	} = $props();

	/** @param {string} type @param {PointerEvent} e */
	function pick(type, e) {
		// Primary button or a touch/pen contact only; a right-click shouldn't pick up a tree.
		if (e.button !== 0) return;
		e.preventDefault(); // no text selection or native image drag under the gesture
		onpick?.(type, e);
	}
</script>

<!-- data-intervention-bin: a placed tree dropped anywhere on the strip is removed. -->
<div class="strip" class:removing data-intervention-bin>
	{#each INTERVENTION_TYPES as type (type.id)}
		<button
			class="tile"
			title="{type.label} — drag onto the map"
			aria-label="{type.label}, drag onto the map"
			onpointerdown={(e) => pick(type.id, e)}
		>
			<span class="icon"><CrownIcon size={type.icon} /></span>
			<span class="caption">{type.label.split(' ')[0]}</span>
		</button>
	{/each}
	<div class="tools">
		<!-- Hides the crowns without removing them, so the heatmap underneath can
		     be read unobstructed. -->
		<button
			class="tool"
			class:off={!treesShown}
			title={treesShown ? 'Hide trees' : 'Show trees'}
			aria-label={treesShown ? 'Hide trees' : 'Show trees'}
			aria-pressed={!treesShown}
			disabled={!count}
			onclick={() => ontoggletrees?.()}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true">
				<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z" />
				<circle cx="8" cy="8" r="2" />
				{#if !treesShown}<path d="M2.5 13.5l11-11" />{/if}
			</svg>
		</button>
		<button class="tool" title="Undo" aria-label="Undo" disabled={!canUndo} onclick={() => onundo?.()}>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 2.5 6.5l3 3M3 6.5h6.5a4 4 0 0 1 0 8H7" /></svg>
		</button>
		<button
			class="tool"
			title={count ? `Remove ${count} placed tree${count === 1 ? '' : 's'}` : 'Nothing placed'}
			aria-label="Clear placed trees"
			disabled={!count}
			onclick={() => onclear?.()}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
		</button>
		{#if count}
			<span class="count">{count}</span>
		{/if}
	</div>
	{#if removing}
		<span class="bin">Drop to remove</span>
	{/if}
</div>

<style>
	/* Placed by the page, centred on the right edge. */
	.strip {
		position: relative;
		display: flex;
		flex-direction: column;
		border: 2px solid #cdc1a9;
		background: #f1ebdf;
		transition: border-color 0.15s;
	}

	.strip.removing {
		border-color: #a2503f;
	}

	button {
		border: 0;
		background: none;
		color: #9a9081;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		color: #6f665a;
		background: #e9e1d1;
	}

	button:disabled {
		cursor: default;
		opacity: 0.4;
	}

	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 0.55rem 0.5rem 0.45rem;
		cursor: grab;
		/* The gesture is ours: no scrolling or zooming the page under a finger. */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}

	.tile + .tile {
		border-top: 1px solid #cdc1a9;
	}

	/* Both crowns sit in the same box, so the captions line up whatever their size. */
	.icon {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
	}

	.caption,
	.count,
	.bin {
		font: 400 0.6rem/1.2 ui-sans-serif, system-ui, sans-serif;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}

	.tools {
		display: flex;
		flex-direction: column;
		align-items: center;
		border-top: 1px solid #cdc1a9;
	}

	.tool {
		display: grid;
		place-items: center;
		width: 100%;
		padding: 0.45rem 0;
	}

	/* Hidden trees: the slashed eye stays in the stronger ink, so the state
	   that's easy to forget is the one that stands out. */
	.tool.off:not(:disabled) {
		color: #6f665a;
	}

	.tool svg {
		width: 0.85rem;
		height: 0.85rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.count {
		padding-bottom: 0.4rem;
		color: #9a9081;
	}

	/* Hangs off the strip's map side while a placed tree is being dragged. */
	.bin {
		position: absolute;
		top: 50%;
		right: calc(100% + 0.4rem);
		padding: 0.35rem 0.6rem;
		border: 1px solid #a2503f;
		white-space: nowrap;
		color: #a2503f;
		background: #f1ebdf;
		transform: translateY(-50%);
		pointer-events: none;
	}
</style>
