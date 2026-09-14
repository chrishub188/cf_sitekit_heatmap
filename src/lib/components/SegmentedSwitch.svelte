<script>
	// A row of mutually exclusive buttons: {id, label}[]. Used for the clip
	// shapes and for the overlay mode switch.
	let { options, active, onselect } = $props();
</script>

<nav>
	{#each options as option}
		<button class:on={option.id === active} onclick={() => onselect?.(option.id)}>
			{option.label}
		</button>
	{/each}
</nav>

<style>
	/* Positioning is the parent panel's job; the 1px gaps let the nav's own
	   background read as hairline dividers between the buttons. */
	nav {
		display: flex;
		gap: 1px;
		background: #cdc1a9;
		font: 400 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
	}

	button {
		padding: 0.5rem 0.9rem;
		border: 0;
		font: inherit;
		white-space: nowrap;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #9a9081;
		background: #f1ebdf;
		cursor: pointer;
	}

	button:hover {
		color: #6f665a;
	}

	button.on {
		color: #f1ebdf;
		background: #9a9081;
	}
</style>
