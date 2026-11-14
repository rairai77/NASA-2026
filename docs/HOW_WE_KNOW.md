# How we know it's right

Content for the in-app "How we know it's right" panel and one slide. Results are quoted from `docs/VALIDATION.md`; the in-app text is in `web/src/lib/validationText.ts`. Checks not yet done are listed as not done. Never show a placeholder as a result.

## One-line version (slide headline)
Sun and Earth directions match JPL Horizons to under 0.0001 degrees; skylines come from LOLA terrain with lunar curvature; limits are stated.

## Methods
1. **Sun and Earth direction.** NAIF SPICE (SpiceyPy) with the DE440 ephemeris gives the Sun and Earth vectors in the Moon's mean-Earth (`MOON_ME`) frame every 15 minutes for 2026-2030. A site's east-north-up frame converts them to azimuth and elevation. Libration is included because the frame is the real, time-varying lunar orientation.
2. **Terrain horizon.** For each of 720 azimuths (360 for grid cells) we march outward over the LOLA DEM stack (20 m near the pole, 80 m, 240 m, then global 64/16/4 pixels per degree), keeping the largest elevation angle `atan2(z_terrain - z_site - d^2/(2R), d)` with R = 1737.4 km. This includes lunar curvature. There is no atmosphere, so no refraction. Observer height is 2 m by default.
3. **Sun disc.** The Sun is 0.53 degrees wide, so at grazing angles it is partly hidden. Visible fraction is `clamp((el_sun - el_horizon + 0.265) / 0.53, 0, 1)`, a first-order area estimate. For ranking, "Sun up" means fraction of 0.5 or more.
4. **Earth.** Earth counts as up when its centre is above the horizon at its azimuth. (PGDA's Earth-visibility maps use "any part visible", so small differences are expected near the horizon.)
5. **Eclipses.** The Sun is partly or fully covered by Earth when the Sun-Earth separation, seen from the Moon, is less than the sum of their angular radii. This is computed with the ephemeris and included in Sun visibility and in `eclipse_hours`.
6. **Region search.** Sun-up and Earth-up bits at 3-hour steps for 1 km cells (to 85°S) are precomputed monthly; queries count bits and runs, then the top 50 candidates are recomputed at 15-minute steps with full-resolution terrain. Outside the pole, a coarser ~10 km global index (1080 x 540 cells, 150 km horizons, 6 h steps) does the same, and its results are flagged coarse.

## Validation checks

### 1. Sun and Earth vs JPL Horizons (done)
Our numpy reference (`pipeline/reference/sky.py`, reading the same `ephem.f32`) vs Horizons (`CENTER='coord@301'`, geodetic site, airless apparent azimuth and elevation, `QUANTITIES=4`), 20 times between 2026-01 and 2031-01 at three sites, site height 0 m.

| Site | Body | Max abs azimuth error x cos(el) (deg) | Max abs elevation error (deg) |
|---|---|---|---|
| Apollo 11 (0.674 N, 23.473 E) | Sun | 0.00000 | 0.00000 |
| Apollo 11 | Earth | 0.00001 | 0.00001 |
| Polar (-89.45, 222.69) | Sun | 0.00000 | 0.00000 |
| Polar | Earth | 0.00000 | 0.00003 |
| Malapert-ish (-85.99, 2.84) | Sun | 0.00000 | 0.00000 |
| Malapert-ish | Earth | 0.00000 | 0.00003 |

Worst case 3e-5 degrees against a target of 0.05. A run at 2000 m site height agrees equally well. Notes: Horizons uses DE441 and we use DE440s (negligible difference here); 15-minute linear interpolation adds at most about 3e-5 degrees. This checks geometry, not terrain.

DSN spot check (2026-06-01 12:00 UTC, Moon elevation vs Horizons): DSS-14 9.8121 vs 9.8122 deg, DSS-43 51.9189 vs 51.9189 deg, DSS-63 -71.6609 vs -71.6609 deg.

### 2. Terrain spot checks (done, internal consistency)
`python -m reference.terrain`: south pole height 1290 / 1291 / 1294 m at the 20 / 80 / 240 m levels; Shackleton floor (-89.67, 129.8) about -2789 m, roughly 4.1 km below the pole; Apollo 11 -1926 m; Malapert (-85.99, 2.84) 5143 m. Level-to-level RMS differences: 20 m vs 80 m 1.4 m, 80 m vs 240 m 3.4 m. These show tiling and resampling are consistent. They are not an independent check against another tool.

### 3. Engine and data checks (done)
| Check | Target | Result |
|---|---|---|
| Rust engine vs JPL Horizons through the engine itself (`engine/parity/horizons_check.py`), 3 sites x 20 times, Sun and Earth | under 0.05 degrees | 3e-5 degrees, pass |
| Native Rust vs WASM on 20 fixed sites (`engine/parity/run_parity.py`), 720-az horizon and 900 s metrics over 2026-03-01 to 03-31 | horizon and angles within 0.01 degrees, hours within 1 minute | horizon 0 degrees, hours 0.000 min, angles 0 degrees (bit-identical), pass |
| Our 2026-2030 sunlit fraction vs PGDA average illumination (Mazarico et al. 2011), 72,324 cells at 85-90°S (`pipeline/validate_pgda.py`) | Pearson r above 0.9 | r = 0.976 (20 rank-spaced cells: 0.996); mean 0.196 vs 0.220, bias -0.023, RMSE 0.039 |
| Our Earth-up fraction vs PGDA average Earth visibility, same cells | r above 0.9 | r = 0.974 (20 cells: 0.988); mean 0.216 vs 0.264, bias -0.049, RMSE 0.070 |
| Our "never lit" cells vs the PGDA permanent shadow mask | agreement stated | 97.7% agreement, IoU 0.81; 7,174 cells dark in both, 1,633 only in ours, 48 only in PGDA |
| Apollo 11 Sun-up hours over 12 consecutive lunations from 2026-01-01 (`engine/parity/apollo11_lunations.py`) | about half a lunation (354.3 h) | mean 353.6 h = 14.74 days, pass |
| Shadow patch vs per-pixel horizons (`engine/parity/phase2_check.mjs`), ridge at -88.79/124.5, 150 pixels | agreement stated | 15 km at 19.5 m/px: 98.7% lit/shaded agreement, mean error 0.013. 30 km at 58.6 m/px: 77%, so local patches use about 20-30 m/px |
| Comms hours vs Earth hours (`engine/parity/comms_check.mjs`), one year from 2026-03-01 | comms hours never exceed Earth hours | pass at 3 sites (Apollo 11 8564.8 of 8760 h). One of 3 DSN complexes sees the Moon at 10 degrees or more for 97.8% of steps |
| Global index query (`engine/parity/global_check.mjs`), 4-month box -60..60 E, -30..30 N, slope at most 5 degrees | runs | rankCoarse 0.59 s over 64,800 cells, rankRefine of 50 candidates 0.14 s (WASM in Node) |
| Unit tests (`cd engine && cargo test --release`, `cd worker && npm test`, `cd web && npm test`) | all pass | Run 2026-11-14: engine 6 passed, worker 6 passed, web 1 passed, 0 failed (counts are not in `docs/VALIDATION.md`) |

### 4. Mission replay (done)
Predicted local sunset minus reported end of operations (`web/src/lib/validationText.ts`, from `pipeline/missions_pred.py`).

| Mission | Delta | Note |
|---|---|---|
| IM-1 (Odysseus), -80.13° | +42.3 h | Tipped on a slope with one panel lit and not built for night, so it ended before true sunset |
| Chandrayaan-3 (Vikram), -69.37° | +3.6 h | Put to sleep as sunset approached |
| Blue Ghost 1, +18.56° | -3.4 h | Operated about 5 h into lunar night on battery |

SLIM, IM-2 and Hakuto-R M2 ended in landing anomalies, not sunsets, so their delta is not a prediction error. Reported end times come from press releases (`data-src/SOURCES.md`) and are uncertain by hours.

### 5. Not done
- Horizon at a polar site vs an independent skyline (QuickMap or Moon Trek): not compared.
- Terrain heights vs an independent tool beyond the spot values above: not compared.

## Limitations and assumptions
- **Earth line of sight, not a link budget.** "Earth up" means Earth's centre is above the local skyline. It does not model antenna pattern, power, diffraction loss, DSN scheduling or relay assets. (DSN complex visibility is computed separately where shown, with a link-margin lane and a relay toggle, but there is no antenna pattern, diffraction loss or scheduling.)
- **Representative points for Artemis regions.** NASA publishes region names and maps but no coordinates. Our points are representative picks described in `data-src/SOURCES.md`; real landing sites inside a region can differ a lot in lighting.
- **Terrain resolution.** LOLA 20 m terrain near the pole (coarser elsewhere). Boulders, small craters and metre-scale features are not resolved, and DEM errors change illumination at the margins. Uncertainty bands from PGDA error clones are not built.
- **Mean-based PGDA comparison.** PGDA averages about 18.6 years hourly and counts partial discs. Ours covers 2026-2030 at 3 h steps with a half-disc Sun rule and a centre-of-disc Earth rule, so our values run slightly lower.
- **Sun-disc approximation.** Partial visibility uses a first-order area estimate, not a limb-darkened integral over the real terrain profile across the disc.
- **Spherical Moon.** Heights are relative to a 1737.4 km sphere, as in the LOLA products.
- **Time span.** Ephemeris covers 2026-2030 only. The 1 km polar index covers latitudes south of 85°S only. Elsewhere the ~10 km global index is coarse (leads, not 20 m answers), and candidates are refined site by site.
- **Permanent shadow is a proxy.** "PSR distance" uses cells with no Sun in 2026-2030 as a proxy. It agrees with the published PGDA mask on 97.7% of cells (IoU 0.81, see check 3). The PSR layer on the globe is the published PGDA mask.
- **Not modelled:** thermal state (Diviner temperatures are shown as a map layer only, not used in any metric), surface charging beyond a warning badge, plume effects, vehicle and trajectory constraints, hazards at metre scale, mission availability windows.
- **Not an official NASA product.** It is a screening aid built on open NASA data and should not be used for flight decisions.
