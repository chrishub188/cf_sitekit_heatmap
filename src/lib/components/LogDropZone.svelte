<script>
	// Listens on the window rather than covering the page with a div: a
	// full-viewport element would take pointer events away from the map, and
	// `pointer-events: none` on it would stop `drop` firing at all.
	let {
		onfile, // (File) => void — reading and parsing are the caller's job
		onerror // (message) => void
	} = $props();

	// Both enter and leave bubble up from every child the cursor crosses, so a
	// boolean would flicker as the pointer passes over the panel and buttons.
	let depth = $state(0);
	const dragging = $derived(depth > 0);

	const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

	function handleDrop(e) {
		if (!hasFiles(e)) return;
		e.preventDefault();
		depth = 0;
		const files = Array.from(e.dataTransfer?.files ?? []);
		if (files.length === 0) return;
		if (files.length > 1) {
			onerror?.('Drop one logfile at a time');
			return;
		}
		onfile?.(files[0]);
	}
</script>

<svelte:window
	ondragenter={(e) => {
		if (hasFiles(e)) {
			e.preventDefault();
			depth++;
		}
	}}
	ondragover={(e) => {
		if (hasFiles(e)) e.preventDefault();
	}}
	ondragleave={() => {
		if (depth > 0) depth--;
	}}
	ondragend={() => (depth = 0)}
	ondrop={handleDrop}
/>

{#if dragging}
	<div class="veil"><span>Drop logfile</span></div>
{/if}

<style>
	.veil {
		position: absolute;
		inset: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: center;
		/* The drop is handled on the window, so this is decoration only and must
		   never intercept the event that dismisses it. */
		pointer-events: none;
		background: rgba(241, 235, 223, 0.55);
		box-shadow: inset 0 0 0 2px #cdc1a9;
	}

	span {
		padding: 0.7rem 1.2rem;
		border: 1px solid #cdc1a9;
		font: 400 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #6f665a;
		background: #f1ebdf;
	}
</style>
