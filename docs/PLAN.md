

# Lunar Landing Site Navigator: Implementation Plan

2026-11-14 · @PJ

A working build by 2026-11-15 11:59 PM Pacific: a site-and-date ranking engine with WYSIWYG query chips, shown on an interactive 3D Moon with terrain-true shadows.

## Product

We are building a ranking engine that answers "which sites and dates work best for my mission?" in under a second, plus a 3D Moon that shows why. It covers the official objectives (site comparison, date flexibility, Sun/Earth vs horizon, power and comms metrics, time to sunset/Earthset, temporal views, all skill levels) and adds things no existing tool offers: whole-region search, landing-ellipse robustness, and (in Extended features) mission replay, scenario diffs, a power and battery model, and traverse planning.

**Users.** Mission planners replanning after a slip ("launch moved 3 months, what's best now?"); educators and the public ("why is the pole so hard?").

**Core features, in build priority**
- 

**Site inspector.** Click any coordinate or pick from a curated list (Apollo, CLPS flown and planned, Chandrayaan-3, Chang'e, SLIM, Artemis regions). Get the horizon plot, a Sun/Earth timeline, and live countdowns to sunset and Earthset.
- 

**Compare.** 2–4 sites side by side on one shared timeline.
- 

**Query chips.** Type a request in plain language; it becomes editable chips (dates, region, filters, ordered objectives, k). The engine returns ranked sites. No AI-written explanation; the chips are the contract.
- 

**3D Moon.** Results as pins on a CesiumJS globe; zoom to terrain; scrub time to see terrain-true shadows and Sun/Earth placement; "stand here" first-person view.
- 

**Landing-ellipse mode.** Worst, median and best case across 50–200 points inside a 100 m to 1 km ellipse.
- 

**Context layers.** Fault scarps, permanently shadowed regions, temperature, slope, keep-out radius around existing landers, and a "near day/night boundary: stronger surface charging" badge.

**Metrics per site and window:** total sunlit hours, longest continuous sunlit stretch, longest continuous darkness, visible fraction of the Sun's disc, mean/min solar elevation, Earth-visible hours, hours with both, eclipse hours, slope, distance to nearest PSR, distance to nearest fault scarp.

**Demo story (30 s video).** "Our CLPS launch slipped from March to June 2028." Type it, chips appear, five ranked sites light up on the Moon. Zoom into the top one, scrub time, the shadow of a crater rim slides away, Earth rises over the ridge, countdown reads 6 d 4 h of sunlight. Flip to an Apollo site for contrast.

## Architecture

There is no application server. Heavy work (downloads, horizons, ephemeris, the region index) happens once offline and is cut into tiles and monthly chunks under 25 MiB each. Cloudflare serves them as static assets. In the browser, the Rust engine compiled to WebAssembly runs in a Web Worker, fetches only the tiles and chunks a query needs, and computes everything locally. The only server code is one tiny Cloudflare Worker that forwards plain-language queries to an LLM so the API key stays secret. Nothing can cold-start or go down during judging.

## Data pipeline

One Python folder (`pipeline/`) downloads, converts and precomputes everything once, and writes browser-ready assets to `web/public/data/`: terrain tile pyramids, the ephemeris table, monthly index chunks, site and mission catalogs, and layers. Every file stays under Cloudflare's 25 MiB per-file limit, and the total file count stays under 20,000 (free plan). Total download for the MVP is about 1.5 GB; skip the 3–5 GB mosaics unless time allows.

### Inputs

Dataset

Use

Source

Size

LOLA LDEM_80S_80M

Polar terrain, horizons, region search grid

PDS LOLA polar

116 MB

LOLA LDEM_85S_20M

Fine terrain near the pole

same

460 MB

LOLA LDEM_64 (global)

Fallback terrain anywhere, far horizon

PDS LOLA archive

~530 MB

LOLA 5 m site DEMs + slope + error clones

Ellipse mode and uncertainty for named polar sites

PGDA 78

per site (stretch)

PGDA polar illumination, Earth visibility, PSR maps

Validation and PSR distance

PGDA 69

COG/GeoTIFF

NAIF kernels: DE440 SPK, Moon PA/ME PCK + frames, LSK

Sun/Earth ephemeris

NAIF generic kernels

~120 MB

Lobate scarp polylines, 60°S–60°N

Fault layer, low latitudes

LROC RDR shapefile

1.2 MB

Polar lobate scarp locations, ±65–90°

Fault layer, poles (points + names)

LROC RDR shapefile/CSV

5 KB CSV

Diviner temperature / rock abundance

Thermal and hazard layers (stretch)

PDS Geosciences Diviner

varies

SVS CGI Moon Kit color + displacement

Globe look (fallback if not using Cesium Moon terrain)

SVS 4720

59 MB (4K)

Site catalog

Curated list

NSSDCA Apollo sites, CLPS and agency releases, NASA Artemis regions

hand-built JSON

### Steps
- 

`fetch.py`: download inputs with checksums into `raw/` (never commit raw data).
- 

`convert.py`: PDS IMG to float32 grids with the label's projection (south polar stereographic, R = 1737.4 km).
- 

`tiles.py`: cut terrain into a pyramid of 256×256 tiles, int16 meters, zstd- or brotli-compressed, with a JSON manifest: 20 m and 80 m polar levels, coarser levels down to LDEM_16 globally, LDEM_64 as the global base. Each tile is ~130 KB raw, far below the 25 MiB limit; keep the count under the file limit by packing small tiles into bundles if needed.
- 

`sites.py`: build `sites.json` (id, name, group, lat, lon, source URL, "representative point" note where needed). Target 30–40 sites.
- 

`ephem.py`: with SpiceyPy, compute Sun and Earth unit vectors (plus Sun disc radius and eclipse geometry) in MOON_ME at 15-min steps, 2026-01-01 to 2030-12-31: ~175k rows, float32, ~4 MB, site-independent.
- 

`index.py`: on the 1 km polar grid (87°S to the pole first, 85°S if time allows), compute horizons with the sweep algorithm, then Sun-up and Earth-up bits at 3-hour steps. Write one file per month: about 1.6 MB for 87°S+ (about 4 MB for 85°S+). Static per-cell columns (slope, PSR distance, fault distance) go in one small file.
- 

`faults.py`: merge both scarp products into one GeoJSON (name, type, source) and precompute distance-to-nearest-fault on the grid.
- 

`curated.py`: for each curated site, precomputed horizon and 5-year metrics JSON so the site list renders instantly before the WASM engine loads.

Pipeline additions for the extended features:
- 

`missions.py`: hand-curated `missions.json` (lander, coordinates, landing and end times, source links) for replay.
- 

`dsn.py`: Moon elevation from Goldstone, Madrid and Canberra at 15-min steps via SpiceyPy (station coordinates from NAIF's DSN station kernel).
- 

`global_horizons.py`: 72-direction uint8 horizons on a ~5 km global grid from LDEM_64 for the global search.
- 

`clones.py`: horizons for each PGDA error clone at named polar sites, for uncertainty bands.
- 

`tiles.sh`: quantized-mesh terrain tiles from the 5 m data (stretch).

## Compute engine

One Rust crate, `engine/`, builds two ways: a native library the Python pipeline calls through PyO3 (so precompute and the browser share code), and a WebAssembly module (wasm-bindgen + wasm-pack) that runs in a browser Web Worker. Multithreading uses wasm-bindgen-rayon with SharedArrayBuffer, which needs cross-origin isolation headers (see Deployment); without them the engine runs single-threaded and shows progress. A small numpy reference implementation in `pipeline/reference/` is kept for validation notebooks, and a parity test on 20 fixed sites fails if any metric differs by more than 1 minute or 0.01°.

### 1. Horizon
- 

Input: lat, lon, observer height h (default 2 m), DEM stack (finest available near, coarser far).
- 

For each azimuth (720 at 0.5° for sites, 360 for the grid): march outward with step = max(pixel size, 0.5% of distance), out to 300 km at the pole and 150 km elsewhere.
- 

Elevation angle per sample: atan2(z_terrain − z_obs − d² / (2R), d), with R = 1737.4 km for lunar curvature. Keep the maximum.
- 

Resolution switch: 20 m grid within 10 km, 80 m to 60 km, LDEM_64 beyond (or outside the polar grid). Record the finest resolution used in the response.
- 

Cost: ~360k bilinear lookups, a few ms in numpy (vectorize all azimuths at once).

### 2. Sun and Earth in the local sky
- 

Rotate the precomputed MOON_ME vectors into the site's east-north-up frame (one 3×3 matrix per site). Azimuth and elevation follow directly.
- 

Sun visible fraction: compare the Sun's elevation with the horizon at that azimuth, treating the disc as 0.53° wide; fraction = clamp((el_sun − el_horizon + 0.265°) / 0.53°, 0, 1) as a first-order area estimate.
- 

Earth visible if its centre is above the horizon (state this; PGDA uses "any part visible").
- 

Eclipse: Sun hidden by Earth's disc as seen from the Moon (angular separation of Sun and Earth < sum of radii), computed in `ephem.py`.
- 

Check: one site against JPL Horizons topocentric az/el, target < 0.05°.

### 3. Metrics

From the boolean or fractional series over the query window: total and longest sunlit run, longest dark run, Earth hours and longest Earth run, both-up hours, mean and minimum solar elevation while lit, eclipse hours, time to next sunset and Earthset from a given instant. Run-length encoding on numpy arrays.

### 4. Region index and ranking
- 

Bitsets: one bit per 3-hour step per cell, Sun up (visible fraction > 0.5) and Earth up, chunked by month.
- 

Query: fetch the month chunks covering the window (a 4-month query is 6–16 MB, cached after), then popcount for totals and run scans for longest runs across all cells, using native u64 popcount in WASM. Milliseconds.
- 

Filters first (slope, min both-up hours, max dark run, PSR distance, fault distance), then lexicographic sort by the ordered objectives, with an optional weighted mode.
- 

Spatial de-duplication: greedy non-maximum suppression with a 2 km minimum separation (user-adjustable chip).
- 

Refine: take the top 50, recompute at full resolution (20 m tiles, 15-minute ephemeris), re-rank, return k.
- 

Sweep horizons: for grids (index cells, traverse patches) use a sweep-line algorithm that computes horizon angles for every cell in one pass per direction, in near-linear time, instead of ray-marching each cell.

### 5. Landing ellipse

Sample N points (default 64) in the ellipse with a Fibonacci-disc pattern, compute horizon and metrics for each, report min / median / max per metric and a mini heatmap. Cached by rounded centre.

## Engine interface and parse Worker

The front end talks to the WASM engine through a typed message API (Comlink over the Web Worker), not HTTP. The engine owns a tile cache (in memory plus the browser Cache API) and fetches static assets on demand. Every result carries `resolution_m`, `model` ("terrain" or "geometric"), and data versions. The only network service is `POST /api/parse` on a Cloudflare Worker.

Engine call

Returns

Data fetched

Target time (warm cache)

`sites()`

Curated catalog

`sites.json`

instant

`horizon(lat, lon, h)`

720 elevation angles + resolution used

nearby fine tiles + coarse far tiles (a few MB first time)

< 20 ms

`visibility(lat, lon, h, start, end, step)`

Sun/Earth az, el, Sun fraction, eclipse flag per step + metrics + next sunset/Earthset

ephemeris (once)

< 20 ms

`compare(ids, start, end)`

Metrics and runs for 2–4 sites on one time base

as above

< 50 ms

`rank(query)`

Ranked sites

monthly index chunks for the window

< 500 ms

`ellipse(center, axes, n)`

Min/median/max metrics + per-point grid

tiles around the ellipse

< 1 s

`layers.faults()`

Fault GeoJSON

`faults.geojson`

instant

`POST /api/parse` (Worker)

Natural language to query JSON

none

< 2 s

### Deployment and cost (Cloudflare)

Decision: one Cloudflare Worker with static assets, on the free plan, at a free `*.workers.dev` subdomain (or `*.pages.dev` if deployed via Pages). Expected cost $0. Cloud Run is dropped.

Limit (Workers free plan)

Value

How we fit

Static asset file size

25 MiB max

Tiles ~130 KB, monthly index chunks 1.6–4 MB

Static asset files per version

20,000 (100,000 on $5/mo paid)

Bundle small tiles; budget ~15k files

Worker CPU per request

10 ms

Parse Worker only forwards one LLM call (wall time is not CPU time)

Worker memory

128 MB

Parse Worker uses almost none

Subrequests per request

50

Parse makes 1

Decisions:
- 

Cross-origin isolation for WASM threads: a `_headers` file sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on the app. Self-host Cesium's assets and all data on the same origin so nothing third-party is blocked; if Cesium ion terrain is used, check it is served with CORS/CORP headers or fall back to our own terrain tiles.
- 

Long cache headers on immutable, content-hashed data files; the engine also stores fetched tiles in the Cache API so repeat visits are instant.
- 

LLM key stored as a Worker secret; add a simple per-IP rate limit and a max input length to `/api/parse`.
- 

Deploy with `wrangler deploy` from CI on push to `main`; preview deployments per branch.
- 

If we outgrow 20,000 files, either bundle tiles or move data to R2 (10 GB free, no egress fees) and fetch with range requests.
- 

Optional stretch only if something can't run in the browser: a scale-to-zero Cloud Run service at 1 vCPU / 2 GiB (free at our traffic).

Sources: Cloudflare Workers limits; Cloud Run figures from the earlier cost check (Cloud Run pricing).

### Query schema (what the chips edit)<=", "value": 144},
    {"metric": "fault_dist_km", "op": ">=", "value": 5}
  ],
  "objectives": [
    {"metric": "earth_hours", "dir": "max"},
    {"metric": "sun_hours", "dir": "max"}
  ],
  "mode": "lexicographic",
  "k": 5,
  "min_separation_km": 2
}]]>

### Natural-language parsing
- 

`/parse` calls an LLM with a single tool whose input schema is the query schema above, plus a list of allowed metric names and units. Output is validated with Pydantic; anything invalid is dropped and flagged.
- 

Unrecognized phrases are returned as `unparsed` so the UI can show them greyed out rather than silently ignoring them.
- 

Relative dates ("next spring") resolve against an explicit "today" passed from the client.
- 

No LLM in the ranking path, and no generated explanation; chips are the only interpretation shown.
- 

A form UI builds the same JSON, so the demo works with the LLM disabled.

## Front end

Vite + React + TypeScript, CesiumJS for the globe (assets self-hosted for cross-origin isolation), D3 for 2D charts, Zustand for one shared app state (selected sites, time cursor, query), Comlink to talk to the WASM engine in a Web Worker. Served as static assets by the Cloudflare Worker. Curated sites render from precomputed JSON while the engine downloads, so the first screen is instant.

### Layout
- 

**Top bar:** query box that turns into chips; chip editing re-runs `/rank`.
- 

**Left panel:** results list (rank, name, key metrics, sparkline of Sun/Earth over the window), curated site picker, layer toggles.
- 

**Centre:** the globe.
- 

**Bottom strip:** shared timeline for selected sites (Sun band, Earth band, both, eclipses) with the draggable time cursor that drives everything else.
- 

**Right drawer (on select):** horizon polar plot with Sun and Earth tracks, countdowns to sunset/Earthset, metric table, resolution and model badges, ellipse results.

### Globe and shadows
- 

Cesium Moon ellipsoid; terrain from Cesium ion's Moon terrain tileset if the token terms fit, else our own quantized-mesh tiles from LOLA (stretch) or a displaced SVS Moon Kit globe.
- 

Sun and Earth: Cesium light direction set from the ephemeris at the time cursor; Earth drawn as a textured billboard at its real direction and size (~2°).
- 

Terrain-true shadows (stretch, after MVP): for the zoomed patch, request a 64-direction horizon texture from the API and apply a custom shader: lit = sun_el > horizon(sun_az), softened over the 0.53° disc. Shadows then match the numbers exactly. Until then use Cesium's built-in shadows and label them "approximate".
- 

Pins for results and curated sites; ellipse drawn as a ground polygon; fault scarps as polylines and points; PSRs and temperature as imagery layers; keep-out circles around landers.

### First-person "stand here"

Camera at 2 m above the site looking along the horizon; skyline drawn from the 720-value horizon as a silhouette ring (cheap and exact), Sun and Earth sprites, compass ticks, countdown overlay. Time scrub animates the Sun skimming the ridge. This is the hero shot for the video.

### Educator mode

A toggle that swaps jargon for plain labels, adds short tooltips (why the pole is hard, libration, dust charging badge, faults), and preloads an Apollo vs polar site comparison.

### Accessibility

Colour-blind safe palette for Sun/Earth/both bands, keyboard time scrubbing, text equivalents for every chart (metric table), works on a laptop screen at 1280 px.

## Extended features

Ten features beyond the MVP, in recommended order. Each reuses the engine; most add one endpoint and one UI panel.

### 1. Replay real missions (validation + story)
- 

Predict local sunset and Earth visibility for landers that actually flew and compare with what happened: IM-1 (Malapert A region, landed Feb 22, 2024, ran until local sunset), Chandrayaan-3 (~69°S, Aug 23, 2023, put to sleep before lunar night), Blue Ghost 1 (Mare Crisium, Mar 2, 2025, operated into the start of lunar night), IM-2 (Mons Mouton area, Mar 6, 2025), SLIM (Jan 19, 2024).
- 

Data: landing times and end-of-mission times from mission press releases; lander coordinates from LROC images of each landing site. Build `missions.json` by hand with a source link per number.
- 

UI: "Replay" button puts the time cursor at landing, plays to predicted sunset, and shows "predicted vs reported" with the difference in hours.
- 

API: reuse `/visibility`; no new compute.

### 2. Scenario diff for replanning
- 

A scenario = site(s) + window + height + filters. Save A and B, then show a diff view: metric deltas (green/red), both timelines stacked, and "what changed" chips (e.g. "longest dark run +31 h").
- 

Preset flow: "launch slipped by N weeks" shifts the window and re-ranks, keeping the old result pinned for comparison.
- 

Client-only plus `/compare`.

### 3. Power and battery model
- 

Inputs (chips): panel type (vertical fixed facing an azimuth, vertical single-axis tracking, horizontal), area, efficiency, load in W, battery depth of discharge.
- 

Power per step: P = 1361 W/m² × area × efficiency × Sun visible fraction × cos(incidence angle). At the pole vertical panels win, which the tool should make obvious.
- 

Outputs: Wh per day, energy over the window, battery Wh needed = load × longest dark run ÷ depth of discharge, and a "survives the night?" flag.
- 

New metrics usable in ranking: `energy_wh`, `battery_wh_needed`. Server-side in the engine so rankings can use them.

### 4. Shareable links and export
- 

Encode the whole scenario (query, selected sites, time cursor, camera) as compressed JSON in the URL hash.
- 

Export: CSV of the timeline and metrics; one-page PDF report (map snapshot, horizon plot, metrics, assumptions, data versions) rendered client-side.
- 

Speaks to the challenge's "coordinate between science and engineering teams" point.

### 5. Rover traverse planner
- 

Grid A* over a local patch (20 m cells, about 10 × 10 km, ~0.5 MB of terrain) with time as a dimension: a cell is passable at time t if slope is under a limit and the rover is sunlit (and optionally in Earth view).
- 

Cost = travel time at a set speed + slope penalty; waiting in place is allowed.
- 

Per-cell horizons for the patch come from the sweep algorithm at 64 directions, with distant terrain computed on a coarse sub-grid and interpolated: roughly 1–3 s in multithreaded WASM, cached per patch. WebGPU compute is an optional speed-up.
- 

Backstop: precomputed traverse grids for the curated polar regions as static assets, used when the device is slow or threads are unavailable.
- 

Output: path polyline on the globe, timeline of light/comms along the path, total distance and duration.
- 

Engine call: `traverse(start, goal, window, limits)`.

### 6. Global region search
- 

The 1 km polar index covers only the cap. For the rest of the Moon, precompute monthly Sun/Earth bitsets on a ~10 km global grid at 6-hour steps: about 6 MB per month per body. A 4-month global query downloads ~50 MB once (cached), or only the latitude bands the query covers.
- 

Scan in WASM (~400k cells × 480 steps, about a second), then refine the top candidates at full resolution from terrain tiles. Flag results that come from the coarse pass.

### 7. Real comms
- 

Earth side: compute the Moon's elevation from the three Deep Space Network complexes (Goldstone, Madrid, Canberra) in the pipeline, and show which antenna can see the Moon at each step. "Earth visible" becomes "Earth visible and a DSN complex in view".
- 

Terrain diffraction: along the path toward Earth, estimate knife-edge loss when Earth sits within about 1–2° of the skyline (single-edge ITU-R P.526 style), shown as "marginal link" instead of yes/no.
- 

Relay toggle: assume continuous coverage from a future relay constellation (NASA LCRNS, ESA Moonlight) so users see how much the Earth-visibility constraint matters.

### 8. Uncertainty bands and our own fine terrain
- 

For named polar sites, compute horizons from all 100 PGDA error clones and report metrics as 5th–95th percentile bands; draw a shaded band on the timeline.
- 

Build quantized-mesh tiles from the 5 m mosaic and site DEMs (for example with Cesium Terrain Builder) so close-ups use our terrain rather than Cesium's.

### 9. Mission availability overlay
- 

Simplified model: from NRHO, landing opportunities recur roughly every 6.5 days (NASA Artemis overview). Let users enter or import launch windows, and intersect them with the site's lit-and-Earth-visible windows.
- 

Label clearly as illustrative; real availability depends on vehicle and trajectory constraints we don't model.

### 10. Approach lighting
- 

For a chosen descent azimuth, show the Sun's elevation and its angle to the approach direction at landing time. Flag when the Sun is in the cameras' eyes or too low to light hazards.
- 

One extra metric, `approach_sun_ok`, usable as a filter.

### New engine calls and assets

Engine call

Feature

New static assets

`missions()`

Replay with predicted vs reported times

`missions.json`

`power(scenario, panel)`

Power and battery model (also ranking metrics)

none

`traverse(start, goal, window, limits)`

Rover path and its light/comms timeline

precomputed traverse grids (backstop)

`rank(query)` with global scope

Global coarse-then-refine search

monthly 10 km global bitsets

`dsn(start, end)`

DSN complex visibility of the Moon

`dsn.bin` (from pipeline)

`uncertainty(site)`

Percentile bands from PGDA clones

per-site clone horizons

## Schedule

Assumes 3–4 people, one per workstream, starting now. The gate that matters is Saturday 6 PM: if engine numbers don't match Horizons by then, stop adding features and fix them. Feature freeze at Sunday noon leaves the afternoon for validation, video and submitting by 9 PM, three hours before the deadline. If short-handed, cut in this order: first-person view, custom shadow shader, NL parsing, ellipse mode. The extended features below start once the MVP works end to end; take mission replay, scenario diff and shareable links first.

## Validation, risks and submission

Validation is a feature, not a chore: a "How we know it's right" panel in the app and a slide in the deck earn the Validity criterion.

### Validation checks
- 

Sun and Earth az/el at 3 sites (one Apollo, two polar) vs JPL Horizons topocentric output: error < 0.05°.
- 

Horizon at a polar site vs an independent skyline from QuickMap or Moon Trek: same ridges at same azimuths.
- 

2026–2030 average sunlit fraction at 20 grid cells vs PGDA average illumination: correlation > 0.9, explain differences (time span, Sun-disc treatment).
- 

Earth visibility fraction vs PGDA Earth map, same comparison.
- 

Unit tests: curvature term, ENU rotation, run-length metrics, bitset popcount vs brute force.
- 

Sanity: Apollo 11 gets ~14.8 days of light per lunation; a known long-lit polar ridge beats nearby crater floors.

### Risks and fallbacks

Risk

Fallback

Frame or projection bug

Horizons check on day 1, before UI work depends on numbers

COOP/COEP headers break Cesium or terrain loading

Self-host everything; if still blocked, ship single-threaded WASM (no isolation needed) with progress bars

Judge's laptop is slow or lacks WASM threads

Single-threaded path, precomputed curated results and traverse grids, smaller default windows

Large first download per region

Content-hashed, long-cached assets; load coarse levels first; show download progress

Exceeding 20,000 static files

Bundle tiles, or move data to R2 with range requests

Cesium ion terms, token or CORS issues

Our own terrain tiles, or three.js globe with SVS Moon Kit

Custom shadow shader not done

Built-in Cesium shadows labelled "approximate" plus exact timeline and horizon plot

LLM parse wrong or unavailable

Editable chips and form UI; parse is optional

Data download eats hours

Start with LDEM_80S_80M and LDEM_16; add finer data later

Overclaiming

Label: "Earth line of sight", "representative point", "not an official NASA product"

### Submission checklist (deadline Nov 15, 11:59 PM local)
- 

All team members registered and on the project page
- 

Public repo, MIT or Apache-2.0, README with setup, data credits and citations (Mazarico 2011, Barker 2021, Watters 2015, Nelson 2014)
- 

Live demo URL that works offline-first
- 

30-second video or short deck, English, no NASA logos, no under-18 faces or names
- 

References field: every dataset, library, and AI tool used (including code assistants)
- 

Use of NASA data and partner data fields filled (QuickMap, Moon Trek, Horizons, LOLA; CSA portal as context)
- 

Submit by 9 PM local to leave margin