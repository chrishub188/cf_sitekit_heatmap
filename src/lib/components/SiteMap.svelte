<script>
	import { onMount } from 'svelte';
	import 'maplibre-gl/dist/maplibre-gl.css';
	// maplibre-gl locates its worker script by guessing a sibling URL from its
	// own bundled chunk's import.meta.url. That guess only holds when the
	// library ships as its own untouched file; once Vite bundles it into a
	// shared chunk (production builds), the guess points at a file that was
	// never copied to the output, so the browser gets a 404/HTML response and
	// refuses it as a worker (wrong MIME type). Importing the worker with
	// `?url` makes Vite copy it as a real build asset and gives us the true
	// URL, which we register explicitly before creating any Map.
	import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

	let {
		mapStyle, // a style object works exactly like a style URL
		bounds, // [west, south, east, north]
		bearing = 0,
		fit = { padding: 40, maxZoom: 19.5 },
		onready // handed the map instance once it exists
	} = $props();

	let container;
	let map;
	let ready = $state(false);

	onMount(async () => {
		// Dynamic import, not top-level: maplibre-gl touches `window` as it
		// initialises and onMount only runs in the browser, so this keeps SSR alive.
		// Depending on the version and how Vite pre-bundles it, the classes sit on
		// `default` or on the namespace itself — accept either.
		const mod = await import('maplibre-gl');
		const maplibregl = mod.default?.Map ? mod.default : mod;
		if (!container?.isConnected) return; // navigated away mid-load

		(maplibregl.setWorkerUrl ?? mod.setWorkerUrl)(maplibreWorkerUrl);

		map = new maplibregl.Map({
			container,
			style: mapStyle,
			bounds,
			fitBoundsOptions: fit,
			bearing,
			maxPitch: 0
		});
		map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-right');
		ready = true;
		onready?.(map);

		return () => map?.remove();
	});

	// Later changes to bounds/bearing fly the camera instead of rebuilding the map.
	$effect(() => {
		const [b, deg] = [bounds, bearing];
		if (ready) map.fitBounds(b, { ...fit, bearing: deg, duration: 1100 });
	});
</script>

<div bind:this={container}></div>

<style>
	div {
		position: absolute;
		inset: 0;
	}
</style>