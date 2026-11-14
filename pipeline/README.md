# Pipeline

Run from `pipeline/` with `uv run python <script>`. Raw downloads go to `raw/` (git-ignored),
outputs to `../web/public/data/` (git-ignored). All scripts are idempotent.

1. `fetch.py`      NAIF kernels, LOLA GDR DEMs (IMG+LBL), SVS color map (resumable, ~1.4 GB)
2. `ephem.py`      `data/ephem/ephem.{json,f32}` (CONTRACTS §1)
3. `tiles.py`      `data/terrain/**` + `manifest.json` (CONTRACTS §2); helpers in `geo.py`
4. `imagery.py`    `data/imagery/color/{z}/{x}/{y}.jpg` + `meta.json` (Cesium GeographicTilingScheme)
5. `dsn.py`        `data/dsn/dsn.{json,i16}` Moon elevation from DSS-14/43/63
6. `validate_ephem.py`  ephemeris vs JPL Horizons (needs network); see `docs/VALIDATION.md`

Engine-dependent steps (need the `lunar_engine` Python module built from `engine/`: `uvx maturin build --release -m engine/Cargo.toml`
and `uv pip install --python .venv/bin/python <wheel>`):

7. `index.py`      `data/index/**` (CONTRACTS §3): 304x304 1 km grid, 360-az horizons (8 gz bands), 60 monthly bitset files,
                   `static.f32`, `manifest.json`. Caches in `work/` (`horizons.npy`, `months/*.npz`; delete to recompute). Timings on 4+ cores:
                   `grid_horizons` ~395 s (72,324 valid cells), bitsets ~40 s, slope/psr/fault ~20 s; ~60 s on a rerun with cache. Output ~59 MB, 70 files.
8. `curated.py`     `data/curated.json` (§4): per-site 720-az horizon, resolution, site elevation, 60 monthly metric dicts (900 s steps),
                   `best_nearby` (highest `sun_frac_5yr` valid index cell within 10 km, ties -> nearest) for candidate regions / representative sites with lat <= -85. ~3 s, ~1 MB.
9. `missions_pred.py` `data/missions_pred.json`: lander horizon, events + 30-min series (landing-2 d .. +20 d), predicted sunset/earthset, delta vs reported end.
                   `predicted_sunset_utc` is the horizon-only sunset (Sun centre vs horizon profile); the engine's own sunset event
                   (`predicted_sunset_incl_eclipse_utc`) also fires during Earth eclipses of the Sun (e.g. 2025-03-14 for Blue Ghost / IM-2). ~2 s.
10. `copy_catalogs.py` copies `data-src/{sites,missions}.json`, `faults.geojson` to `data/`.

`run_all.sh` runs everything (uv sync, fetch, ephem, tiles, imagery, dsn, engine wheel, index, curated, missions_pred, copy_catalogs) from any cwd.
Each step is skipped if its output exists (`FORCE=1` reruns all) and the engine wheel is only built when index/curated/missions_pred
still have to run and `lunar_engine` is not importable (~20 s warm, longer cold). Per-step timings are printed; a full cache hit takes < 1 s.

References for cross-checking the Rust engine: `reference/terrain.py` (bilinear tile sampler with
level fallback; `python -m reference.terrain` prints sanity values) and `reference/sky.py`
(topocentric Sun/Earth az/el from `ephem.f32`).

Map layers and PGDA cross-check (CONTRACTS §0, §3):

- `layers.py`      `data/layers/{psr,illum,earthvis,tmax,tavg}/{z}/{x}/{y}.png` + `layers/manifest.json`
                   (Cesium GeographicTilingScheme palette PNGs, ~2260 files / ~33 MB). Inputs in `raw/pgda/`
                   (PGDA product 69 GeoTIFFs, 240 m, 65-90S) and `raw/diviner/` (Diviner Polar Resource Product
                   `dlre_prp_south.tab`, 600 MB, from PDS Geosciences `lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp/`).
- `validate_pgda.py`  `--fetch` downloads the PGDA files; extracts PGDA at the 1 km index cells to `work/pgda_grid.npz`
                   and, once `data/index/static.f32` exists, compares with `sun_frac_5yr`/`earth_frac_5yr` (see `docs/VALIDATION.md`).
