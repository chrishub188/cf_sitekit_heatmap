# CF Temperature Map

A SvelteKit + MapLibre GL app for visualising urban thermal comfort (PET —
Physiological Equivalent Temperature) as a heatmap over site plans.

Each site is a small study area with a pre-computed PET grid. The map shows
the site's outline and lets you switch between sites and between two grid
resolutions; cells are colored on a red–blue scale (red = hotter/higher PET).

## Sites & data

Sites are configured in [src/lib/sites.js](src/lib/sites.js):

- **Dahlbergplatz** (Mannheim)
- **Am Altenhof** (Kaiserslautern)

Each site ships two CSV grids under [static/data/](static/data/):

- `5mx5m/` — 5 m grid, coordinates already in lon/lat (WGS84)
- `1mx1m/` — 1 m grid, coordinates in UTM zone 32N (EPSG:25832), reprojected
  client-side in [Heatmap.svelte](src/lib/components/Heatmap.svelte)

Each CSV has `x`, `y`, and a `pet` (or `value`) column; an optional `ntzg`
column flags land-use classes excluded from the heatmap by default.

To add a new site: add its bounding-box center, label, and CSV paths to
`SITES` in `src/lib/sites.js`, and drop the corresponding CSVs into
`static/data/5mx5m/` and `static/data/1mx1m/`.

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
