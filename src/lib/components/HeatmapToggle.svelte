<script>
	// Shows or hides the heatmap cells, e.g. to read the planning areas on their
	// own. Drawn as a small switch rather than a filled button: next to the
	// resolution switch a filled button reads as "selected option", not as
	// something that turns a layer on and off.
	let { active = true, onselect } = $props();
</script>

<button
	role="switch"
	aria-checked={active}
	class:on={active}
	title={active ? 'Hide heatmap' : 'Show heatmap'}
	onclick={() => onselect?.(!active)}
>
	<span class="track"><span class="knob"></span></span>
	Heatmap
</button>

<style>
	/* Borderless: the page's top-right panel frames it, with a hairline to the
	   resolution buttons beside it. */
	button {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.5rem 0.9rem;
		border: 0;
		font: 400 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #b3a891;
		background: #f1ebdf;
		cursor: pointer;
	}

	button:hover {
		color: #6f665a;
	}

	button.on {
		color: #6f665a;
	}

	.track {
		position: relative;
		width: 1.6rem;
		height: 0.9rem;
		border-radius: 999px;
		background: #cdc1a9;
		transition: background 0.15s;
	}

	.knob {
		position: absolute;
		top: 0.12rem;
		left: 0.12rem;
		width: 0.66rem;
		height: 0.66rem;
		border-radius: 50%;
		background: #f1ebdf;
		box-shadow: 0 1px 1px rgb(0 0 0 / 0.15);
		transition: transform 0.15s;
	}

	button.on .track {
		background: #9a9081;
	}

	button.on .knob {
		transform: translateX(0.7rem);
	}

	button:focus-visible {
		outline: 2px solid #9a9081;
		outline-offset: 2px;
	}
</style>
