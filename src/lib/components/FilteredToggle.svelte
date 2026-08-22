<script>
	let { active = false, onselect } = $props();
</script>

<label>
	<input type="checkbox" checked={active} onchange={(e) => onselect?.(e.currentTarget.checked)} />
	<span class="swatch"></span>
	Schwarzplan
</label>

<style>
	label {
		position: absolute;
		bottom: 1rem;
		left: 1rem;
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.5rem 0.9rem;
		border: 1px solid #cdc1a9;
		background: #f1ebdf;
		font: 400 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #9a9081;
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

	.swatch {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 2px;
		background: #141414;
		opacity: 0.55;
	}
</style>
