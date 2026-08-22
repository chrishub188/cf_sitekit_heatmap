<script>
	let { shapes, active, onselect } = $props();
</script>

<nav>
	{#each shapes as shape}
		<button class:on={shape.id === active} onclick={() => onselect?.(shape.id)}>
			{shape.label}
		</button>
	{/each}
</nav>

<style>
	nav {
		position: absolute;
		bottom: 3.35rem;
		left: 1rem;
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
