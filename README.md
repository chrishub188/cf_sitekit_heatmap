# CF Temperature Map

A SvelteKit + MapLibre GL app for visualising urban thermal comfort (PET —
Physiological Equivalent Temperature) as a heatmap over site plans.

Each site is a small study area whose PET grid is fetched from the simulation
backend. The map shows the site's outline and lets you switch between sites
and between two grid resolutions; cells are colored on a red–blue scale
(red = hotter/higher PET).

## Sites & data

Sites are configured in [src/lib/sites.js](src/lib/sites.js):

- **Dahlbergplatz** (Mannheim)
- **Am Altenhof** (Kaiserslautern)
- **TH-Vorplatz** (Mannheim)

Each site's grid comes from the backend's `calculateEnvGrid` endpoint
(`gridType=PET`, 150 m radius around the site center), relayed through
[/api/env-grid](src/routes/api/env-grid/+server.js) because the backend is
plain http without CORS. Set `ENV_GRID_API_URL` to point the relay at a
different backend. The backend returns 1 m cells in UTM zone 32N
(EPSG:25832); the 5 m view averages them client-side
([envgrid.js](src/lib/envgrid.js)). Cells without a value (buildings) are
the ones the Schwarzplan toggle shows.

Dropping a logfile of tree placements requests the same grid again with the
trees as `interventions` and shows the recalculated heatmap for that site.

To add a new site: add its bounding-box center, label, and plaza outline
to `SITES` in `src/lib/sites.js`.

[static/geojson/](static/geojson/) holds the original site-boundary GeoJSON
files the bbox centers in `sites.js` were derived from. They're reference
only — not fetched at runtime; `sites.js` rebuilds each site's bounding box
and study-area polygon from its `center` instead.

## Map style

[src/lib/style.js](src/lib/style.js) defines `customStyle`, a MapLibre style
JSON for a warm "paper site plan" look (cream ground, tan paving, hairline
buildings, sage planting). Basemap layers come from OpenStreetMap vector
tiles (VersaTiles, Shortbread schema); a `sites` GeoJSON source built from
`SITE_AREAS` (in `sites.js`) adds the site marker and label on top.

## Developing

Install dependencies, then start the dev server:

```sh
npm install
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

```sh
npm run build
```

Preview the production build with `npm run preview`. To deploy, you may need
to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target
environment (this project currently uses `adapter-auto`).

## Type checking

```sh
npm run check
```
