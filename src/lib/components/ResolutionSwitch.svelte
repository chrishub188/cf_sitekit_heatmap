<script>
	let { resolutions, active, onselect } = $props();
</script>

<nav>
	{#each resolutions as resolution}
		<button
			class:on={resolution.id === active}
			disabled={resolution.disabled}
			title={resolution.title}
			onclick={() => onselect?.(resolution.id)}
		>
			{resolution.label} <span class="unit">{resolution.unit}</span>
		</button>
	{/each}
</nav>

<style>
	/* Placed by the page's top-right group, next to the heatmap toggle. */
	nav {
		display: flex;
		gap: 1px;
		padding: 1px;
		border: 1px solid #cdc1a9;
		background: #cdc1a9;
		font: 400 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
	}

	button {
		padding: 0.5rem 0.9rem;
		border: 0;
		font: inherit;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #9a9081;
		background: #f1ebdf;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		color: #6f665a;
	}

	/* A site without data at this resolution. */
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
