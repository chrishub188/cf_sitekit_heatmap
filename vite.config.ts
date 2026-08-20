import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		})
	],

	// maplibre-gl loads its worker as a sibling module. Vite's dep optimizer
	// rewrites the package into node_modules/.vite/deps/ but doesn't carry the
	// worker file along, so the browser gets a 404 with an empty MIME type and
	// refuses it. The package is already ESM, so skipping the optimizer costs
	// nothing and lets the worker resolve next to its own source.
	environments: {
		client: {
			optimizeDeps: { exclude: ['maplibre-gl'] }
		}
	},

	// Keeps the worker an ES module in production builds too.
	worker: { format: 'es' }
});