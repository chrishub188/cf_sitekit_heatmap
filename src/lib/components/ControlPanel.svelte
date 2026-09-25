<script>
	// One bordered box in the bottom-left corner holding every map control, so
	// the corner reads as a single element instead of a stack of loose chips.
	let { children } = $props();
</script>

<div class="panel">
	{@render children()}
</div>

<style>
	/* Placed by the page's bottom-left corner stack; sized by the widest row
	   there, while the legend bar keeps its own minimum. */
	.panel {
		border: 2px solid #cdc1a9;
		background: #f1ebdf;
	}

	/* Tighter than the switches out on the map: the clip-shape row sets the
	   panel's width, so its padding is what keeps the box compact. */
	.panel :global(nav button),
	.panel :global(label) {
		padding-inline: 0.7rem;
	}

	/* Hairline between the scale row and the clipping row. */
	.panel > :global(* + *) {
		border-top: 1px solid #cdc1a9;
	}
</style>
