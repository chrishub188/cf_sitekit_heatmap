<script>
	// The tree crown as drawn on the map (CROWN_SHAPE): planting-green fill at the
	// map's new-tree opacity, an ink edge, and a pale halo just outside it.
	import { CROWN_PATH } from '$lib/interventions.js';
	import { PLANTING_FILL, PLANTING_INK } from '$lib/style.js';

	let {
		size = 22, // px
		opacity = 0.55, // fill; the same default as TreeOverlay's
		ink = PLANTING_INK,
		fill = PLANTING_FILL
	} = $props();

	// Mask ids are document-global, so every instance needs its own — one that
	// matches between the server render and hydration.
	const uid = $props.id();
	const mask = `crown-halo-${uid}`;
</script>

<svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
	<defs>
		<mask id={mask}>
			<rect width="44" height="44" fill="#fff" />
			<path d={CROWN_PATH} fill="#000" />
		</mask>
	</defs>
	<path
		d={CROWN_PATH}
		fill="none"
		stroke="#fff"
		stroke-opacity="0.55"
		stroke-width="3.75"
		stroke-linejoin="round"
		mask="url(#{mask})"
	/>
	<path d={CROWN_PATH} fill={fill} fill-opacity={opacity} stroke={ink} stroke-width="1.75" stroke-linejoin="round" />
</svg>

<style>
	svg {
		display: block;
		overflow: visible;
	}
</style>
