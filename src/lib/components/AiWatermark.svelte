<script>
	let { label = 'AI generated' } = $props();
</script>

<!-- Turned on its side and floated against the right edge, where nothing else
     lives: the corners already hold the site tabs, resolution switch, control
     panel and map credits. -->
<div class="watermark" aria-label={label}>
	<span class="mark">
		<!-- A four-point sparkle, the common shorthand for "AI". -->
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M12 2c.6 4.9 2.8 8.4 10 10-7.2 1.6-9.4 5.1-10 10-.6-4.9-2.8-8.4-10-10 7.2-1.6 9.4-5.1 10-10Z" />
		</svg>
	</span>
	<span>{label}</span>
</div>

<style>
	/* writing-mode, not a rotate transform, so the box keeps its real rotated
	   size and right: 1rem means the same inset as the resolution switch above.
	   The extra 180° turn makes the text read bottom-to-top. */
	.watermark {
		position: absolute;
		top: 50%;
		right: 1rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding-block: 0.2rem;
		padding-inline: 0.2rem 0.65rem; /* snug around the mark, roomier after the text */
		border: 1px solid #cdc1a9;
		border-radius: 999px;
		writing-mode: vertical-rl;
		transform: translateY(-50%);
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
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		background: #9a9081;
	}

	svg {
		width: 0.7rem;
		height: 0.7rem;
		fill: #f1ebdf;
	}
</style>
