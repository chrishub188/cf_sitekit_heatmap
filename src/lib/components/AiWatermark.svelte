<script>
	import { onMount } from 'svelte';

	let {
		map, // maplibre Map instance; the label joins its bottom-right controls
		label = 'AI generated'
	} = $props();

	/** @type {HTMLDivElement} */
	let el;

	// Registered as a MapLibre control so it stacks with the scale bar and the
	// credits in the bottom-right corner rather than being placed by hand over
	// them: their heights change with the zoom and the attribution's width.
	onMount(() => {
		const control = {
			onAdd: () => el,
			onRemove: () => el.remove()
		};
		map.addControl(control, 'bottom-right');
		return () => {
			if (map.hasControl(control)) map.removeControl(control);
		};
	});
</script>

<div bind:this={el} class="watermark maplibregl-ctrl" aria-label={label}>
	<span class="mark">
		<!-- A four-point sparkle, the common shorthand for "AI". -->
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M12 2c.6 4.9 2.8 8.4 10 10-7.2 1.6-9.4 5.1-10 10-.6-4.9-2.8-8.4-10-10 7.2-1.6 9.4-5.1 10-10Z" />
		</svg>
	</span>
	<span>{label}</span>
</div>

<style>
	/* The same pill as the map credits below it (see the page's bottom-right
	   rules): height, border, lettering and an ink disc for the icon, mirrored
	   to the left where the credits have their (i) on the right. */
	.watermark {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		box-sizing: border-box;
		width: fit-content;
		min-height: 1.5rem;
		padding: 0 0.6rem 0 0.3rem;
		border: 1px solid #cdc1a9;
		border-radius: 0.8rem;
		font: 400 0.62rem/1.2 ui-sans-serif, system-ui, sans-serif;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #9a9081;
		background: rgb(241 235 223 / 0.85);
		pointer-events: none;
		user-select: none;
	}

	.mark {
		display: grid;
		place-items: center;
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 50%;
		background: #9a9081;
	}

	svg {
		width: 0.55rem;
		height: 0.55rem;
		fill: #f1ebdf;
	}
</style>
