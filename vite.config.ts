import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';

// maplibre-gl loads its worker by guessing a URL relative to its own module's
// import.meta.url at runtime, and that worker in turn imports a sibling
// "maplibre-gl-shared.mjs" chunk the same way. Both guesses only hold when
// maplibre-gl ships as its own untouched file next to its siblings — once a
// bundler inlines it into a shared chunk (as Rollup does for production
// builds), the guessed URLs point at files that were never copied to the
// output, so the browser 404s and refuses to run the worker. This plugin
// serves the two files maplibre-gl actually needs at fixed, literal paths in
// both dev and build, and SiteMap.svelte points maplibre-gl at them directly
// via `setWorkerUrl` instead of relying on its runtime guess.
function maplibreWorkerAssets(): Plugin {
	const distDir = fileURLToPath(new URL('./node_modules/maplibre-gl/dist/', import.meta.url));
	const files = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

	return {
		name: 'maplibre-worker-assets',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const name = req.url?.slice(1);
				if (!name || !files.includes(name)) return next();
				res.setHeader('Content-Type', 'text/javascript');
				res.end(readFileSync(distDir + name));
			});
		},
		generateBundle() {
			if (this.environment?.name === 'ssr') return;
			for (const name of files) {
				this.emitFile({ type: 'asset', fileName: name, source: readFileSync(distDir + name) });
			}
		}
	};
}

export default defineConfig({
	plugins: [
		maplibreWorkerAssets(),
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
