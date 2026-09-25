<script>
	// Quiet note beside a "+ Load" button that the file can also be dragged onto
	// the map — the drop zone itself is invisible until a drag starts.
	let { title = 'Drag a file anywhere onto the map' } = $props();
</script>

<span {title}>
	<!-- A tray with an arrow into it: the usual "drop here" mark. -->
	<svg viewBox="0 0 16 16" aria-hidden="true">
		<path d="M8 2v7.5M4.8 6.5 8 9.7l3.2-3.2" />
		<path d="M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />
	</svg>
	or drop on map
</span>

<style>
	/* Deliberately a step fainter than everything else in the panels: it's a
	   hint, not a control. */
	span {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding-right: 0.9rem;
		font: 400 0.62rem/1.2 ui-sans-serif, system-ui, sans-serif;
		letter-spacing: 0.03em;
		white-space: nowrap;
		color: #cdc1a9;
		cursor: default;
		transition: color 0.15s;
	}

	span:hover {
		color: #9a9081;
	}

	svg {
		width: 0.7rem;
		height: 0.7rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
