# Lunar Landing Site Navigator: interface contracts

This file is the single source of truth that the pipeline (`pipeline/`), the Rust
engine (`engine/`), the web app (`web/`) and the Cloudflare Worker (`worker/`)
agree on. If you need to change a contract, change it here first and say so.

## 0. Conventions

- Moon is a sphere, `R = 1737400.0 m` (LOLA reference radius). All heights are
  meters relative to this sphere.
- Lat/lon are planetocentric degrees in the **MOON_ME** (mean Earth / polar axis)
  frame, the frame LOLA DEMs use. Longitude is east-positive. API inputs accept
  any longitude; outputs use [-180, 180).
- Body-fixed Cartesian: `x = cos(lat)cos(lon)`, `y = cos(lat)sin(lon)`, `z = sin(lat)`
  (unit vector), times radius. +x points at 0°N 0°E (toward Earth on average).
- Time is **UTC Unix seconds** as f64 everywhere in APIs. Ephemeris rows are on
  a uniform UTC grid (no leap seconds are scheduled 2023-2030).
- Local sky: azimuth in degrees clockwise from local north (N=0, E=90), in
  [0, 360). Elevation in degrees. "North" at a south-polar site is the direction
  toward the north pole along the meridian.
- Default observer height above terrain: `h = 2 m`.
- All binary files are little-endian. `*.gz` files are gzip-compressed and
  served as-is (no Content-Encoding); the browser decompresses with
  `DecompressionStream('gzip')`, native code with `flate2`.
- Every deployable data file lives under `web/public/data/` (git-ignored, built by
  the pipeline) and must be < 25 MiB. Total file count < 18,000.

## 1. Ephemeris: `data/ephem/ephem.json` + `data/ephem/ephem.f32`

```json
{ "t0_unix": 1672531200, "step_s": 900, "n": 280512,
  "frame": "MOON_ME", "origin": "MOON", "abcorr": "LT+S",
  "columns": ["sun_x_km","sun_y_km","sun_z_km","earth_x_km","earth_y_km","earth_z_km"],
  "kernels": ["naif0012.tls","de440s.bsp","moon_pa_de440_200625.bpc","moon_de440_250416.tf"],
  "start_utc": "2023-01-01T00:00:00Z", "end_utc": "2031-01-01T00:00:00Z" }
```

`ephem.f32` is `n` rows × 6 float32 = positions (km) of the Sun and the Earth
relative to the Moon's center, in MOON_ME, aberration-corrected as seen from the
Moon center (`spkpos(target, et, 'MOON_ME', 'LT+S', 'MOON')`). Row `i` is time
`t0_unix + i*step_s`. Consumers interpolate linearly between rows.

Topocentric direction to a body from a site at position `P` (km, MOON_ME):
`v = B - P`. This parallax matters for Earth (~0.26°), so always subtract `P`.

## 2. Terrain tiles: `data/terrain/manifest.json` + tiles

```json
{
  "tile_size": 256, "height_scale": 0.5, "nodata": -32768, "radius_m": 1737400,
  "levels": [
    { "id": "s0", "proj": "south_stereo", "pixel_m": 20,  "x0": -151680, "y0": 151680,
      "width": 15168, "height": 15168, "tiles_x": 60, "tiles_y": 60,
      "path": "terrain/s0/{ty}/{tx}.i16.gz", "missing": [] , "source": "LDEM_85S_20M" },
    { "id": "s1", "proj": "south_stereo", "pixel_m": 80, ... "source": "LDEM_80S_80M" },
    { "id": "s2", "proj": "south_stereo", "pixel_m": 240, ... "source": "LDEM_60S_240M" },
    { "id": "g0", "proj": "equirect", "ppd": 64, "lon_min": 0, "lat_max": 90,
      "width": 23040, "height": 11520, "tiles_x": 90, "tiles_y": 45,
      "path": "terrain/g0/{ty}/{tx}.i16.gz", "missing": [], "source": "LDEM_64" },
    { "id": "g1", "proj": "equirect", "ppd": 16, ... "source": "LDEM_16" },
    { "id": "g2", "proj": "equirect", "ppd": 4,  ... "source": "LDEM_4" }
  ]
}
```

- A tile is `tile_size²` int16 values, row-major (row 0 = top), gzip-compressed.
  `height_m = value * height_scale`. `nodata` marks pixels outside the source.
  Tiles at the right/bottom edge are padded with `nodata`. Tiles listed in
  `missing` ("tx,ty" strings) were not written (fully nodata or deliberately
  dropped, e.g. s2 tiles with center farther than 700 km from the pole).
- **south_stereo** (spherical polar stereographic, true scale at the pole,
  center lon 0; identical to the LOLA polar products, PROJ
  `+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400`):
  for unit vector `u`: `x = 2R*u_y/(1-u_z)`, `y = 2R*u_x/(1-u_z)`.
  Inverse: `rho = hypot(x,y)`, `lat = -90 + 2*atan(rho/(2R))` (deg), `lon = atan2(x, y)`.
  Pixel (row i, col j) of a level has its **center** at
  `(x0 + (j+0.5)*pixel_m, y0 - (i+0.5)*pixel_m)`; `x0,y0` is the top-left corner.
- **equirect**: pixel (row i, col j) center is at
  `lat = lat_max - (i+0.5)/ppd`, `lon_east = lon_min + (j+0.5)/ppd` (0..360, wraps).
- Sampling is bilinear in pixel space using pixel centers. If any of the 4
  neighbours is nodata or its tile is absent, the sample is invalid at that level
  and the caller falls back to the next coarser level.
- Level preference for a point: `s0`, `s1`, `s2` (only for lat < -60), then
  `g0`, `g1`, `g2`.

## 3. Region index (south polar grid)

`data/index/manifest.json`:

```json
{
  "grid": { "proj": "south_stereo", "cell_m": 1000, "x0": -152000, "y0": 152000,
            "nx": 304, "ny": 304, "max_lat": -85.0 },
  "height_m": 2, "n_az": 360, "step_s": 10800,
  "static": { "file": "index/static.f32", "columns":
      ["lat","lon","elev_m","slope_deg","sun_frac_5yr","earth_frac_5yr","psr_dist_km","fault_dist_km"] },
  "horizons": { "rows_per_band": 38, "bands": ["index/horizons/b0.i16.gz", "..."], "scale_deg": 0.01 },
  "months": [ { "month": "2026-01", "file": "index/months/2026-01.u64.gz",
                "t0_unix": 1767225600, "n_steps": 248, "words": 4 }, "..." ]
}
```

- Cell `(i, j)` (row, col) center = `(x0 + (j+0.5)*cell_m, y0 - (i+0.5)*cell_m)`;
  cell id `c = i*nx + j`. A cell is valid if its center latitude <= `max_lat`.
- `static.f32`: for each column in order, `nx*ny` float32 values (column-major
  blocks). Invalid cells hold NaN. `slope_deg` is the mean slope over the cell
  from the 20 m level. `sun_frac_5yr`/`earth_frac_5yr` are fractions of 3-hour
  steps with the Sun up / Earth up over 2026-2030. `psr_dist_km` is distance to
  the nearest cell with `sun_frac_5yr == 0` (our proxy for permanent shadow).
  `fault_dist_km` is distance to the nearest mapped lobate scarp (NaN if no
  fault layer).
- Month file (after gunzip): two blocks, each `nx*ny*words` u64 values:
  first the **Sun-up** bits, then the **Earth-up** bits. For cell `c`, step `s`
  (0-based, time `t0_unix + s*step_s`) the bit is
  `(block[c*words + s/64] >> (s%64)) & 1`. Bits beyond `n_steps` are 0.
  Month boundaries are UTC calendar months; months cover 2026-01..2030-12.
- Sun up at a step := Sun visible fraction (horizon and eclipse included) >= 0.5.
  Earth up := Earth's center elevation > horizon elevation at Earth's azimuth.
- Horizon bands (after gunzip): band `b` holds rows `b*rows_per_band ..` (last
  band shorter), layout `[row][col][az]` int16, elevation = value * 0.01°,
  az index k = k*360/n_az degrees. Invalid cells hold -32768.

## 4. Catalogs (hand-curated sources in `data-src/`, copied to `data/`)

`data/sites.json`: array of
```json
{ "id": "apollo11", "name": "Apollo 11 (Tranquility Base)", "group": "Apollo",
  "lat": 0.67416, "lon": 23.47314, "kind": "landed",
  "representative": false, "note": "", "source": "https://..." }
```
`group` in {"Apollo","Luna","Chang'e","Chandrayaan","SLIM","CLPS","Artemis III regions","Other"};
`kind` in {"landed","planned","candidate_region","reference"}. `representative: true`
means a single point stands in for a region.

`data/missions.json`: array of
```json
{ "id": "im1", "name": "IM-1 Odysseus", "lat": -80.13, "lon": 1.44,
  "landed_utc": "2024-02-22T23:23:00Z", "end_utc": "2024-02-29T00:00:00Z",
  "end_reason": "Local sunset; battery depleted", "reported_note": "short human text",
  "sources": ["https://..."] }
```
`data/faults.geojson`: FeatureCollection of LineString/Point features with
properties `{ "name": str|null, "kind": "lobate_scarp", "source": str }`.

`data/curated.json`: `{ "<site id>": { "horizon": [720 f32 deg], "resolution_m": 20,
"site_elev_m": f32, "monthly": [ { "month": "2026-01", <window metrics> }, ... ] } }`
precomputed for every site in `sites.json`, so the UI is instant before WASM loads.

## 5. Metrics (names are shared by engine, query chips and UI)

Window metrics (over a time window, from a 15-minute series unless noted):

| name | unit | meaning |
|---|---|---|
| `sun_hours` | h | hours with Sun up (visible fraction >= 0.5) |
| `sun_frac` | 0-1 | sun_hours / window hours |
| `longest_sun_h` | h | longest continuous Sun-up run |
| `longest_dark_h` | h | longest continuous Sun-down run |
| `earth_hours` | h | hours with Earth up |
| `longest_earth_h` | h | longest continuous Earth-up run |
| `longest_no_earth_h` | h | longest continuous Earth-down run |
| `both_hours` | h | hours with Sun up AND Earth up |
| `longest_both_h` | h | longest continuous both-up run |
| `mean_sun_el_deg` | deg | mean Sun elevation while Sun up |
| `min_sun_el_deg` | deg | minimum Sun elevation while Sun up |
| `sun_disc_frac_mean` | 0-1 | mean visible fraction of the Sun's disc while Sun up |
| `eclipse_hours` | h | hours where Earth covers part of the Sun's disc while the Sun is above the horizon |
| `energy_wh` | Wh | (power model) energy over the window |
| `battery_wh_needed` | Wh | (power model) load × longest_dark_h / depth of discharge |

Static metrics: `lat`, `lon`, `elev_m`, `slope_deg`, `psr_dist_km`, `fault_dist_km`.

Runs touching the window edges count only the part inside the window.

## 6. Query schema (what the chips edit)

```json
{
  "window": {"start": "2028-03-01", "end": "2028-06-30"},
  "region": {"type": "polar", "min_lat": -90, "max_lat": -85},
  "height_m": 2,
  "filters": [ {"metric": "slope_deg", "op": "<=", "value": 8},
               {"metric": "longest_both_h", "op": ">=", "value": 144} ],
  "objectives": [ {"metric": "earth_hours", "dir": "max"},
                  {"metric": "sun_hours", "dir": "max"} ],
  "mode": "lexicographic",
  "weights": null,
  "k": 5,
  "min_separation_km": 2
}
```

- `window.start/end`: `YYYY-MM-DD` (00:00 UTC) or full ISO-8601 UTC. End exclusive.
- `region.type`: `polar` (`min_lat`, `max_lat`), `circle` (`lat`, `lon`,
  `radius_km`), or `sites` (`ids`: curated site ids; ranks those sites only).
  `global` is reserved for the extended global search.
- `op` in `<`, `<=`, `>`, `>=`. `dir` in `max`, `min`.
- `mode`: `lexicographic` compares objectives in order after rounding (hours to
  3 h, degrees to 0.5°, km to 0.5 km, fractions to 0.01); `weighted` uses
  `weights` (same length as objectives) on min-max normalised values.
- Ranking pipeline: region mask → coarse metrics from month bitsets → filters
  → sort → greedy non-maximum suppression with `min_separation_km` → top 50 →
  refine each at 15-minute steps using the stored grid horizon → filters and
  sort again → top `k`.

## 7. Engine API

Rust core crate `engine` (lib name `lunar_engine`). Pure compute, no network.
Data is pushed in by the host (Python or JS). Features: `python` (PyO3 module
`lunar_engine`) and `wasm` (wasm-bindgen class `Engine`). Both bindings are thin
wrappers over the same core functions. JSON-ish values cross the WASM boundary
via `serde-wasm-bindgen` (plain JS objects); big arrays as typed arrays.

WASM class `Engine` (camelCase in JS):

| method | returns |
|---|---|
| `new Engine()` | |
| `loadEphemeris(metaJson: string, bytes: Uint8Array)` | |
| `loadTerrainManifest(json: string)` | |
| `addTile(levelId: string, tx: number, ty: number, raw: Uint8Array)` | raw = gunzipped 131072 bytes |
| `hasTile(levelId, tx, ty): boolean` | |
| `requiredTiles(lat, lon, maxDistKm: number \| undefined, nAz: number): string[]` | keys `"s0/ty/tx"` the horizon march will touch (incl. bilinear neighbours) |
| `requiredTilesArea(lat, lon, radiusKm, levelId?: string): string[]` | tiles covering a disc (for ellipse, patches, terrain sampling) |
| `horizon(lat, lon, heightM, nAz): HorizonResult` | `{ nAz, elevDeg: Float32Array, resolutionM, maxDistKm, siteElevM, missingSamples }` |
| `visibility(lat, lon, heightM, elevDeg: Float32Array, tStart, tEnd, stepS): VisResult` | see below |
| `loadIndexManifest(json)`, `loadIndexStatic(raw: Uint8Array)`, `addIndexMonth(month, raw)`, `addHorizonBand(band: number, raw)` | |
| `indexMonthsNeeded(tStart, tEnd): string[]` | |
| `rankCoarse(query): { candidates: Candidate[], bandsNeeded: number[], stats }` | |
| `rankRefine(query, candidates): RankResult` | |
| `ellipse(lat, lon, semiMajorM, semiMinorM, rotDeg, n, heightM, tStart, tEnd, stepS): EllipseResult` | |
| `sampleHeights(west, south, east, north, w, h): Float32Array` | heights (m) on a w×h lat/lon grid incl. edges, row 0 = north; for Cesium terrain |
| `shadowPatch(lat, lon, sizeKm, px, tUnix): ShadowPatch` | lit/shade + hillshade raster for the overlay (extended) |

`VisResult`:
```
{ t: Float64Array, sunAz, sunEl, sunFrac, earthAz, earthEl: Float32Array,
  earthUp: Uint8Array, eclipseFrac: Float32Array,
  metrics: { <window metric name>: number },
  events: [ { t: number, kind: "sunrise"|"sunset"|"earthrise"|"earthset"|"eclipse_start"|"eclipse_end" } ] }
```
`Candidate`: `{ cell, lat, lon, metrics: {...} }`. `RankResult`:
`{ results: [ { rank, cell, lat, lon, metrics: {...}, coarseMetrics: {...} } ], considered, passedFilters, resolutionM, model: "terrain" }`.
`EllipseResult`: `{ points: [ {lat, lon, metrics} ], summary: { <metric>: {min, median, max} } }`.

Sun visible fraction against a locally flat horizon at elevation `hz`:
with `r` the Sun's angular radius and `t = clamp((el - hz)/r, -1, 1)`,
`frac = 1 - (acos(t) - t*sqrt(1-t²))/π`. Multiply by `(1 - eclipse_frac)`
where `eclipse_frac` is the fraction of the Sun's disc covered by Earth's disc
(circle-circle overlap). Horizon elevation at a non-integer azimuth is
linearly interpolated between azimuth bins (wrapping).

Horizon march: for each azimuth, start at `d = finest pixel size`, step
`d += max(pixel_m(level at d), 0.005*d)`, out to 300 km if |lat| > 75° else
150 km. Level by distance: `s0` while d < 10 km, `s1` while d < 60 km, then
`s2`; outside polar coverage use `g0` while d < 60 km then `g1`. Points move
along the great circle (`p = cos(d/R)*u + sin(d/R)*t_az`). Elevation angle
with exact curvature: observer radius `ro = R + z_site + h`, target radius
`rt = R + z(d)`, `theta = d/R`:
`el = atan2(rt*cos(theta) - ro, rt*sin(theta))`. Keep the maximum per azimuth.

Python module `lunar_engine` mirrors the core: `Engine()` with
`load_ephemeris_files(json_path, f32_path)`, `load_terrain_dir(data_dir)`
(reads manifest + all tiles from disk, optionally restricted to level ids),
`horizon(lat, lon, h, n_az) -> np.ndarray`, `visibility(...) -> dict`,
`grid_horizons(levels..., nx, ny, ...) -> np.ndarray[int16]` (parallel, rayon),
`grid_bitsets(horizons, month_t0, n_steps, step_s) -> (sun_u64, earth_u64)`.

## 8. Web worker API (TypeScript, `web/src/engine/api.ts`)

The UI never touches WASM directly. A Web Worker owns the `Engine`, all data
fetching (Cache API + in-memory), and exposes this interface through Comlink:

```ts
export interface EngineApi {
  init(baseUrl: string): Promise<{ threads: number; crossOriginIsolated: boolean; dataVersion: string }>;
  sites(): Promise<Site[]>;
  missions(): Promise<Mission[]>;
  curated(): Promise<Record<string, CuratedSite>>;
  horizon(lat: number, lon: number, heightM?: number): Promise<HorizonResult>;
  visibility(lat: number, lon: number, tStart: number, tEnd: number, opts?: { heightM?: number; stepS?: number; elevDeg?: Float32Array }): Promise<VisResult>;
  compare(points: { id: string; lat: number; lon: number }[], tStart: number, tEnd: number): Promise<Record<string, VisResult>>;
  rank(query: Query, onProgress?: (p: Progress) => void): Promise<RankResult>;
  ellipse(args: EllipseArgs): Promise<EllipseResult>;
  sampleHeights(west: number, south: number, east: number, north: number, w: number, h: number): Promise<Float32Array>;
  sunEarthAt(lat: number, lon: number, t: number): Promise<{ sunAz: number; sunEl: number; earthAz: number; earthEl: number; sunVecMe: [number, number, number]; earthVecMe: [number, number, number] }>;
  faults(): Promise<GeoJSON.FeatureCollection>;
}
```

A `MockEngine` with the same interface (synthetic but plausible data) lets the
UI run before the WASM build and data exist.

## 9. Parse Worker: `POST /api/parse`

Request `{ "text": string (<= 500 chars), "today": "YYYY-MM-DD" }`.
Response `{ "query": <partial Query>, "unparsed": [string], "warnings": [string] }`.
The Worker calls an LLM through **OpenRouter** (OpenAI-compatible
`https://openrouter.ai/api/v1/chat/completions`) with one forced function tool
whose parameters schema is the query schema (enumerating allowed metric names),
validates the tool arguments, drops invalid pieces into `warnings`, and never
returns free-text explanations. Model id comes from the `PARSE_MODEL` var.
Per-IP rate limit (e.g. 20/min). Secret: `OPENROUTER_API_KEY`.

## 10. Repo layout

```
engine/        Rust crate (core + python + wasm features)
pipeline/      Python (uv) offline pipeline; raw downloads in pipeline/raw/ (git-ignored)
data-src/      hand-curated JSON (sites, missions) committed to git
web/           Vite + React + TS app; web/public/data/ is built output (git-ignored)
worker/        Cloudflare Worker (static assets + /api/parse), wrangler.toml at repo root
docs/          contracts and validation notes
```
