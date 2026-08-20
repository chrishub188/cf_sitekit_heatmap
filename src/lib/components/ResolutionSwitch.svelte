<script>
	let { resolutions, active, onselect } = $props();
</script>

<nav>
	{#each resolutions as resolution}
		<button class:on={resolution.id === active} onclick={() => onselect?.(resolution.id)}>
			{resolution.label}
		</button>
	{/each}
</nav>

<style>
	nav {
		position: absolute;
		top: 1rem;
		right: 1rem;
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

	button:hover {
		color: #6f665a;
	}

	button.on {
		color: #f1ebdf;
		background: #9a9081;
	}
</style>
