# CF Temperature Map

A SvelteKit + MapLibre GL app for visualising urban thermal comfort (PET —
Physiological Equivalent Temperature) as a heatmap around a visitor's live
location.

Rather than a manually browsable map, the app follows the visitor: it centers
on their live position, and — if they're standing inside one of a fixed set
of pre-surveyed study areas — clips that site's PET grid to a radius around
them and shows it as a heatmap, colored on a red–blue scale (red = hotter/
higher PET).

## Using the app

1. On load, the app requests location access (the browser's normal
   geolocation permission prompt) and starts tracking position continuously.
2. It also listens for compass heading. On iOS, this requires an explicit tap
   — an **"Enable compass"** button appears until you grant it.
3. Once a location fix arrives, a marker appears there with a heading wedge
   pointing the way you're facing, and the camera centers on it.
4. If that location falls inside one of the known survey sites (see below),
   the camera reframes to that site's crop, and the site's PET heatmap
   appears clipped to a circle around you. Outside all sites, the camera
   still frames the area around you, but no heatmap is shown.
5. All of this keeps following you live as your position and heading change
   — the marker, camera, and heatmap clip continuously update in place, no
   reload or manual interaction required. There's no UI for picking a site
   or grid resolution; the app is entirely driven by location and heading,
   whether from device sensors or an external source (see
   [Location & heading input](#location--heading-input)).

## Sites & data

Sites are configured in [src/lib/sites.js](src/lib/sites.js):

- **Dahlbergplatz** (Mannheim)
- **Am Altenhof** (Kaiserslautern)
- **TH-Vorplatz**

Each site ships a 1x1 m PET grid CSV under [rawdata/1mx1m/](rawdata/1mx1m/),
with coordinates in UTM zone 32N (EPSG:25832). Each CSV has `x`, `y`, and a
`pet` (or `value`) column; an optional `ntzg` column flags land-use classes
excluded from the heatmap by default.

Those CSVs are the source of truth but are **not** what the app loads — hence
`rawdata/` rather than `static/`, everything under which is copied verbatim
into the build. [scripts/prepare-data.js](scripts/prepare-data.js) reprojects
them to EPSG:4326 ahead of time and writes
[static/data/prepared/](static/data/prepared/) — flat coordinate arrays plus
the grid's cell basis vectors. Reprojecting ~94k points and parsing a CSV in
the browser cost the better part of a second on desktop and several on a
headset, right when the heatmap was supposed to appear. Run

```sh
npm run prepare:data
```

after adding or replacing a CSV, and commit the generated JSON (the app reads
it directly, so `npm run dev` / `npm run build` need no extra step).

Heatmap colours run on a **fixed** PET scale, `PET_MIN`/`PET_MAX` in
[Heatmap.svelte](src/lib/components/Heatmap.svelte) (currently 31–46 °C, red =
hot). Fixed rather than fitted to whatever is in view: a scale derived from the
current clip circle makes the same cell change colour as the visitor walks, so
the same colour would mean a different temperature from one moment to the next.
Readings outside the range are clamped to the end colours — change those two
constants to retune.

Each site also has a boundary file under
[static/geojson/](static/geojson/) (`*_bbox_300m.geojson`) — this is fetched
at runtime, not just for reference: its polygon defines the site's real ~300m
survey area, which `siteForLocation()` in `sites.js` uses to decide whether a
visitor's live location falls inside that site, and its `center` property
seeds the tighter camera-framing crop around it.

To add a new site: drop the CSV into `rawdata/1mx1m/` and run
`npm run prepare:data`, then add an entry to `SITES` in `src/lib/sites.js` (an
`id`, a `bearing` to align the camera with the site's own grid, and a `data`
path pointing at the generated `static/data/prepared/<id>.json`), and add a
matching `*_bbox_300m.geojson` boundary file to `static/geojson/` with a
`center` property and a boundary ring covering the real survey area.

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
- [Heatmap.svelte](src/lib/components/Heatmap.svelte) — the current site's
  PET grid, reprojected and clipped to a radius around the visitor.

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
    heading updates far more often than position). Messages are tagged with
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

The camera uses `jumpTo` rather than an animated move for the same reason: an
easing camera re-renders and re-requests tiles continuously, and with a live
feed each move aborts the previous one mid-flight anyway.

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
