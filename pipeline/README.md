# Pipeline

Run from `pipeline/` with `uv run python <script>`. Raw downloads go to `raw/` (git-ignored),
outputs to `../web/public/data/` (git-ignored). All scripts are idempotent.

1. `fetch.py`      NAIF kernels, LOLA GDR DEMs (IMG+LBL), SVS color map (resumable, ~1.4 GB)
2. `ephem.py`      `data/ephem/ephem.{json,f32}` (CONTRACTS §1)
3. `tiles.py`      `data/terrain/**` + `manifest.json` (CONTRACTS §2); helpers in `geo.py`
4. `imagery.py`    `data/imagery/color/{z}/{x}/{y}.jpg` + `meta.json` (Cesium GeographicTilingScheme)
5. `dsn.py`        `data/dsn/dsn.{json,i16}` Moon elevation from DSS-14/43/63
6. `validate_ephem.py`  ephemeris vs JPL Horizons (needs network); see `docs/VALIDATION.md`

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
