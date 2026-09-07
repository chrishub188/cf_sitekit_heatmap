<script>
	// One bordered box in the bottom-left corner holding every map control, so
	// the corner reads as a single element instead of a stack of loose chips.
	let { children } = $props();
</script>

<div class="panel">
	{@render children()}
</div>

<style>
	.panel {
		position: absolute;
		bottom: 1rem;
		left: 1rem;
		/* sized by the widest row, but never narrower than a readable gradient */
		width: fit-content;
		min-width: 23rem;
		border: 2px solid #cdc1a9;
		background: #f1ebdf;
	}

	/* Hairline between the scale row and the clipping row. */
	.panel > :global(* + *) {
		border-top: 1px solid #cdc1a9;
	}
</style>
