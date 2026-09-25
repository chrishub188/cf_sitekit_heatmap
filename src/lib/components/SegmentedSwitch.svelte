<script>
	// A row of mutually exclusive buttons: {id, label, disabled?, title?}[]. Used
	// for the clip shapes, the overlay mode switch, the before/after switch, the
	// resolution and the basemap.
	let { options, active, onselect } = $props();
</script>

<nav>
	{#each options as option}
		<button
			class:on={option.id === active}
			disabled={option.disabled}
			title={option.title}
			onclick={() => onselect?.(option.id)}
		>
			{option.label}{#if option.unit}&nbsp;<span class="unit">{option.unit}</span>{/if}
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

	button:hover:not(:disabled) {
		color: #6f665a;
	}

	button:disabled {
		color: #cdc1a9;
		cursor: default;
	}

	button.on {
		color: #f1ebdf;
		background: #9a9081;
	}

	.unit {
		text-transform: none;
	}
</style>
