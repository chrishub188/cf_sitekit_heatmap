# CF Temperature Map

A SvelteKit + MapLibre GL app for visualising urban thermal comfort (PET —
Physiological Equivalent Temperature) as a heatmap around a visitor's live
location.

Rather than a manually browsable map, the app follows the visitor: it centers
on their live position, requests the PET grid around them from the EnvGrid
service, and clips it to a radius around them as a heatmap, colored on a
red–blue scale (red = hotter/higher PET). Where the service has no readings,
no overlay is drawn and the location marker is shown on its own.

## Using the app

1. On load, the app requests location access (the browser's normal
   geolocation permission prompt) and starts tracking position continuously.
2. It also listens for compass heading. On iOS, this requires an explicit tap
   — an **"Enable compass"** button appears until you grant it.
3. Once a location fix arrives, a marker appears there with a heading wedge
   pointing the way you're facing, and the camera centers on it.
4. The PET heatmap appears clipped to a circle around you, wherever you are —
   the grid is requested from the API for your position (see
   [Grid data](#grid-data)).
5. All of this keeps following you live as your position and heading change
   — the marker, camera, and heatmap clip continuously update in place, no
   reload or manual interaction required. There's no UI for picking a site
   or grid resolution; the app is entirely driven by location and heading,
   whether from device sensors or an external source (see
   [Location & heading input](#location--heading-input)).

## Grid data

Readings come from the EnvGrid service:

```
GET {ENV_GRID_BASE}/calculateEnvGrid?centerCoordinate=…&radiusInMeters=…&gridType=PET
-> { sessionId, centerCoordinate, radiusInMeters, gridType, gridData: (number|null)[][] }
```

`gridData` is a dense 2-D array of readings with no coordinates at all.
[src/lib/envGrid.js](src/lib/envGrid.js) reconstructs them from the response's
centre and radius into flat column arrays plus one cell basis, which is what
[src/lib/data.js](src/lib/data.js) turns into typed arrays and clips.

The service is reached through [src/routes/api/grid/+server.js](src/routes/api/grid/+server.js),
a same-origin SvelteKit endpoint rather than a direct browser fetch. It's plain
SvelteKit with nothing host-specific, and it solves three things at once: the
service is `http` while the app is served over `https` (a browser blocks that
outright), its CORS headers aren't ours to change, and identical requests can
be cached in front of it instead of re-running the model. Set its upstream in
`.env`:

```sh
cp .env.example .env   # then edit ENV_GRID_BASE
```

The API docs don't say how a `GpsCoordinate` is spelled in a query string, so
the route tries the plausible spellings in order on first use and remembers
whichever one the service accepts.

Heatmap colours run on a **fixed** PET scale, `PET_MIN`/`PET_MAX` in
[Heatmap.svelte](src/lib/components/Heatmap.svelte) (currently 32–45 °C, red =
hot). Fixed rather than fitted to whatever is in view: a scale derived from the
current clip circle makes the same cell change colour as the visitor walks, so
the same colour would mean a different temperature from one moment to the next.
Readings outside the range are clamped to the end colours — change those two
constants to retune.

### Cell pitch and grid orientation

Two things about the response have to be derived rather than assumed.

**Pitch** — the metres between samples, i.e. how big one cell is drawn. It
isn't reported, and the service may answer a larger radius with a coarser grid,
so it's computed per response from `radiusInMeters` and the array dimensions.
Guessing it wrong is silently wrong output: too small leaves gaps between
cells, too large overlaps them.

**Orientation** — the docs say lines (x) run west to east and columns (y) north
to south, i.e. `gridData[x][y]`. **The service actually returns
`gridData[y][x]`**, so the default is `gridorder=yx`. This is worth settling
numerically rather than by eye: a square grid makes a transpose undetectable at
runtime, and PET is smooth enough in space that the wrong orientation still
renders as a plausible-looking heat pattern — just in the wrong place. The
check scores all four candidates against a survey whose missing readings are
building footprints, so they can't line up by chance:

```sh
npm run dev
npm run check:grid    # needs the untracked survey CSVs — see below
```

It names the winner. Measured against the live service, all three sites agree
on `yx`/`top`, against 51-69% for the documented reading. `?gridorder=` and
`?gridnorth=` override the default without a redeploy if the service ever
changes.

**Rotation** — the grid is not north-aligned either. The service models on UTM,
so its rows run along the projection's easting axis, off true east by the grid
convergence. That is nothing at the grid centre and grows with distance, so it
shows up as agreement decaying with radius rather than as a wrong winner:

| distance from grid centre | treated as north-aligned | with the rotation applied |
|---|---|---|
| 0-25 m | 98.6% | 99.6% |
| 100-125 m | 96.2% | 99.2% |
| 200-225 m | 91.0% | 98.1% |

`envGrid.js` therefore rotates by the convergence, deriving the UTM zone from
the response's own centre so it needs no configuration. With it applied, all
three sites score 99.3-99.5% with a mean PET difference of 0.05-0.08 °C — the
residue of the check's own metre-lattice rounding.

### Keeping requests rare

The host posts a pose at ~5 Hz and the service must see nothing like that, so
[src/lib/gridSource.js](src/lib/gridSource.js) anchors the request:

- The request centre only moves once the visitor has walked far enough that
  their clip circle would leave the fetched grid — about 40 m at the defaults,
  not once per pose.
- The new centre is then snapped to a 25 m lattice, making the URL canonical:
  two headsets in the same place, or the same visitor tomorrow, produce a
  byte-identical request that a cache can serve.
- Superseded requests are aborted, failures back off exponentially with
  jitter, and the four most recent grids stay cached, so pacing back and forth
  costs nothing.

Fetch radius is the main lever (`?gridradius=`, default 100 m). At a 1 m pitch:

| radius | grid | values | raw | gzip |
|---|---|---|---|---|
| 60 m | 121² | 14 641 | ~91 KB | ~25 KB |
| **100 m** | 201² | 40 401 | ~250 KB | ~65 KB |
| 150 m | 301² | 90 601 | ~560 KB | ~150 KB |

Bigger means fewer requests but a heavier response and a slower clip scan,
which runs over every cell in the grid each time the visitor moves 2 m.

### Staleness

The data models a fixed moment (14:00), not a timeseries, so **nothing polls**.
A grid is fetched once per area and cached hard. When the host changes the
world it is modelling — planting a tree that re-models the surroundings — it
says so, and every cache is invalidated:

```js
iframeEl.contentWindow.postMessage({ source: 'cf-temperature-map', refreshGrid: true }, '*');
```

`?gridepoch=<n>` does the same at load time.

### Query parameters

| param | default | meaning |
|---|---|---|
| `grid` | `api` | `api`, or `off` for basemap and marker only |
| `gridtype` | `PET` | `TEMPERATURE_CELSIUS`, `NOISE`, `CO2`, `HUMIDITY`, … — note only PET has a tuned colour ramp |
| `gridradius` | `100` | fetch radius in metres, 60–300 |
| `gridepoch` | `0` | bump to bypass every cache |
| `gridorder` / `gridnorth` | `xy` / `top` | orientation override, see above |

### When there is no data

There is no fallback data. If the service can't be reached, or has nothing for
where the visitor is standing, the overlay is simply absent — the marker still
follows them, and the grid reappears when a request succeeds. A grid already on
screen keeps being clipped against the live position while the next one loads,
but is dropped once it no longer reaches the visitor, so the overlay is never a
disc that ends mid-screen or readings from somewhere else.

Failures back off (2, 4, 8 … 60 s, jittered) and each schedules its own retry.
That scheduling isn't optional: a visitor standing still generates no new
requests, so without it the first failure would be the last attempt ever made.

### The survey reference data (not in the repo)

Three areas were surveyed on a 1x1 m grid before the service existed. Those
readings are the ground truth the orientation and rotation findings above were
measured against — but they are **deliberately untracked**, along with the
script that reads them: see the *Local validation tooling* block in
`.gitignore`. Nothing in the app depends on either, so a clone builds and runs
without them; only `npm run check:grid` needs them, and it will fail with
"Cannot find module" on a machine that doesn't have them.

If you have them, they live outside `static/` (everything under `static/` is
copied verbatim into the build, and nothing fetches these over HTTP):

- `rawdata/1mx1m/*.csv` — the survey output, in UTM zone 32N (EPSG:25832), with
  `x`, `y` and a `pet` (or `value`) column. `scripts/check-grid-orientation.js`
  reprojects them to EPSG:4326 itself, so there is no preparation step and
  nothing to keep in sync.
- `rawdata/geojson/*_bbox_300m.geojson` — the surveyed areas' real ~300 m
  extents. Nothing reads them; the check derives each survey's centre from the
  CSV's own extent. They are kept as the provenance record for where the
  readings came from.

These grids are **UTM-aligned, not north-aligned** — their cells are rotated by
the grid convergence at each site, 0.41° at Dalbergplatz and 0.94° at Am
Altenhof. So is the service's, which is how that was established; `envGrid.js`
applies the same rotation (see *Cell pitch and grid orientation*).

## Map style

[src/lib/style.js](src/lib/style.js) defines `customStyle`, a MapLibre style
JSON for a warm "paper site plan" look (cream ground, tan paving, hairline
buildings, sage planting). All basemap layers — ground, buildings, roads,
land-use fills — come from OpenStreetMap vector tiles (VersaTiles, Shortbread
schema); there's no app-specific site marker or label layer in the basemap
itself. The live-location marker and the heatmap are drawn on top by their
own components:

- [LocationMarker.svelte](src/lib/components/LocationMarker.svelte) — the
  dot and heading wedge at the visitor's live location. These sit on two
  separate sources: position and heading change at very different rates, so a
  turn in place only re-uploads the wedge.
- [Heatmap.svelte](src/lib/components/Heatmap.svelte) — the PET grid around
  the visitor, clipped to a radius and coloured by a paint expression.

## Location & heading input

The marker, camera follow, and heatmap radial clip are all driven by two
stores — `location` ([src/lib/location.js](src/lib/location.js)) and
`heading` ([src/lib/heading.js](src/lib/heading.js)) — which can each be fed
from either of two sources, decided independently at page load. The embedded
side of both lives in [src/lib/embedPose.js](src/lib/embedPose.js): one
`message` listener for the whole app, registered once at page load.

- **Device (default)** — `navigator.geolocation.watchPosition` and the
  `deviceorientation`/`deviceorientationabsolute` events. Used whenever the
  page loads with no `lat`/`lng`/`heading` query params — e.g. plain
  browser or mobile testing.
- **Embedded (external)** — for driving the app from a host app, such as a
  Unity/Meta Quest app that already knows the visitor's position and
  bearing and embeds this app via `<iframe>`:
  - **Initial value** comes from query params on the iframe's URL:
    `?lat=<latitude>&lng=<longitude>&heading=<degrees>`. `lat`/`lng` and
    `heading` are checked independently, so e.g. `?heading=90` alone still
    lets location fall back to the device while heading is externally driven.
    For example, to open directly on the TH-Vorplatz site facing east:
    ```
    https://your-deployed-map.example.com/?lat=49.469456&lng=8.483312&heading=90
    ```
  - **Live updates** arrive via `postMessage` from the parent frame, so the
    iframe never has to navigate/reload to reflect a new position:
    ```js
    iframeEl.contentWindow.postMessage(
    	{ source: 'cf-temperature-map', lat, lng, heading },
    	'*'
    );
    ```
    `lat`/`lng` and `heading` can be sent together or separately (e.g.
    heading updates far more often than position). A `refreshGrid: true`
    field invalidates the cached grids — see [Staleness](#staleness). Messages are tagged with
    `source: 'cf-temperature-map'` so unrelated `message` events are
    ignored; the sender's origin is intentionally not validated. An optional
    numeric `id` field, if the host sends one, is treated as a monotonic
    counter and used to drop out-of-order messages. If updates stop arriving,
    the marker/heatmap simply freeze at the last known value.

### Keeping up with a live feed

A host posting at ~5 Hz is enough to saturate a WebView's main thread if every
message is allowed to move the camera and rebuild the heatmap, which shows up
as the whole app lagging and heading updates arriving seconds late. Three rules
keep that in check:

- **Nothing is throttled on arrival.** `embedPose.js` applies every message
  immediately; filtering by elapsed time would only add latency without
  removing the work that actually costs something.
- **Heading is never gated either.** It's one number going into a store and it
  only touches the wedge source. Turning is what a visitor notices most.
- **Position is gated on real movement** — `MIN_MOVE_M` (1 m) in `location.js`.
  A standing visitor's GPS jitter, or a host re-posting the same fix, publishes
  nothing at all, so camera, marker, site lookup and heatmap stay idle.
- **The heatmap clip is gated more coarsely still** — `MIN_CLIP_MOVE_M` (2 m)
  in `Heatmap.svelte`, with only one rebuild in flight at a time and only the
  newest position queued behind it.
- **Grid requests are gated more coarsely again** — roughly one per 40 m
  walked, not one per pose, and a grid already in hand keeps being clipped
  against the live position while the next one loads. See
  [Keeping requests rare](#keeping-requests-rare).

The camera uses `jumpTo` rather than an animated move for the same reason: an
easing camera re-renders and re-requests tiles continuously, and with a live
feed each move aborts the previous one mid-flight anyway.

## Developing

Install dependencies, point `ENV_GRID_BASE` at the grid service, then start the
dev server:

```sh
npm install
cp .env.example .env
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
