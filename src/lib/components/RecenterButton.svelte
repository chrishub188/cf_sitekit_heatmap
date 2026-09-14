<script>
	import { FIT } from '$lib/sites.js';

	let {
		map, // maplibre Map instance
		bounds, // [west, south, east, north] the camera returns to
		bearing = 0
	} = $props();

	// Shown only once someone has zoomed, panned or rotated away from the framing.
	let moved = $state(false);

	// Only gestures carry an originalEvent; the camera flights from a site switch
	// or from this button don't, so they never reveal the button.
	$effect(() => {
		/** @param {{ originalEvent?: Event }} e */
		const onmove = (e) => {
			if (e.originalEvent) moved = true;
		};
		map.on('move', onmove);
		return () => map.off('move', onmove);
	});

	// SiteMap flies back to the framing whenever it changes, which is a recenter too.
	$effect(() => {
		[bounds, bearing];
		moved = false;
	});

	function recenter() {
		map.fitBounds(bounds, { ...FIT, bearing, duration: 800 });
		moved = false;
	}
</script>

{#if moved}
	<button onclick={recenter} aria-label="Recenter map">
		<!-- Frame corners around a dot: "fit the site back into view". -->
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4" />
			<circle class="dot" cx="8" cy="8" r="1.75" />
		</svg>
		Recenter
	</button>
{/if}

<style>
	/* Deliberately its own control, not a twin of the Before/After chip beside
	   it: a single hairline border, no inner ring. The 1px the chip spends on
	   its ring is folded into the padding so both still sit at one height. */
	button {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: calc(0.5rem + 1px) 0.9rem;
		border: 1px solid #cdc1a9;
		border-radius: 999px;
		font: 400 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
		white-space: nowrap;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: #9a9081;
		background: #f1ebdf;
		cursor: pointer;
	}

	button:hover {
		color: #6f665a;
	}

	svg {
		width: 0.8rem;
		height: 0.8rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.dot {
		fill: currentColor;
		stroke: none;
	}
</style>
