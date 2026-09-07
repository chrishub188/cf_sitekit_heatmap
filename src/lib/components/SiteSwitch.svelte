<script>
	let { sites, active = 0, onselect } = $props();
</script>

<nav>
	{#each sites as site, i}
		<button class:on={i === active} onclick={() => onselect?.(i)}>
			{site.label}<small>{site.note}</small>
		</button>
	{/each}
</nav>

<style>
	nav {
		position: absolute;
		top: 1rem;
		left: 1rem;
		display: flex;
		gap: 1px;
		padding: 1px;
		border: 1px solid #cdc1a9;
		background: #cdc1a9;
		font: 400 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
	}

	button {
		display: grid;
		gap: 0.2rem;
		padding: 0.5rem 0.9rem;
		border: 0;
		font: inherit;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		text-align: left;
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

	small {
		font-size: 0.62rem;
		letter-spacing: 0.06em;
		text-transform: none;
		opacity: 0.7;
	}
</style>