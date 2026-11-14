# How we know it's right

Content for the in-app "How we know it's right" panel and one slide. Results are quoted from `docs/VALIDATION.md`; anything not yet run is marked `TODO(verify)` and must be filled in or removed before submission. Never show a placeholder as a result.

## One-line version (slide headline)
Sun and Earth directions match JPL Horizons to under 0.0001 degrees; skylines come from LOLA terrain with lunar curvature; limits are stated.

## Methods
1. **Sun and Earth direction.** NAIF SPICE (SpiceyPy) with the DE440 ephemeris gives the Sun and Earth vectors in the Moon's mean-Earth (`MOON_ME`) frame every 15 minutes for 2026-2030. A site's east-north-up frame converts them to azimuth and elevation. Libration is included because the frame is the real, time-varying lunar orientation.
2. **Terrain horizon.** For each of 720 azimuths (360 for grid cells) we march outward over the LOLA DEM stack (20 m near the pole, 80 m, 240 m, then global 64/16/4 pixels per degree), keeping the largest elevation angle `atan2(z_terrain - z_site - d^2/(2R), d)` with R = 1737.4 km. This includes lunar curvature. There is no atmosphere, so no refraction. Observer height is 2 m by default.
3. **Sun disc.** The Sun is 0.53 degrees wide, so at grazing angles it is partly hidden. Visible fraction is `clamp((el_sun - el_horizon + 0.265) / 0.53, 0, 1)`, a first-order area estimate. For ranking, "Sun up" means fraction of 0.5 or more.
4. **Earth.** Earth counts as up when its centre is above the horizon at its azimuth. (PGDA's Earth-visibility maps use "any part visible", so small differences are expected near the horizon.)
5. **Eclipses.** The Sun is partly or fully covered by Earth when the Sun-Earth separation, seen from the Moon, is less than the sum of their angular radii. This is computed with the ephemeris and included in Sun visibility and in `eclipse_hours`.
6. **Region search.** Sun-up and Earth-up bits at 3-hour steps for 1 km cells (to 85°S) are precomputed monthly; queries count bits and runs, then the top 50 candidates are recomputed at 15-minute steps with full-resolution terrain.

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
`python -m reference.terrain`: south pole height 1290 / 1291 / 1294 m at the 20 / 80 / 240 m levels; Shackleton floor (-89.67, 129.8) about -2789 m, roughly 4.1 km below the pole; Apollo 11 -1926 m; Malapert (-85.99, 2.84) 5143 m. Level-to-level RMS differences: 20 m vs 80 m 1.4 m, 80 m vs 240 m 3.4 m. These show tiling and resampling are consistent. TODO(verify) compare a few against published values or an independent tool (QuickMap or Moon Trek elevation readout) and add the numbers.

### 3. Pending checks (TODO(verify): fill in or delete)
| Check | Target | Result |
|---|---|---|
| Native Rust vs WASM parity on 20 fixed sites (`engine/parity/check.mjs`), horizons and window metrics | metrics within 1 minute and 0.01 degrees | TODO(verify) |
| Rust engine vs numpy reference vs Horizons through the engine itself (not only the Python reference) | under 0.05 degrees | TODO(verify) |
| 2026-2030 average sunlit fraction at 20 polar cells vs PGDA average illumination (Mazarico et al. 2011) | correlation above 0.9, differences explained (time span, Sun-disc treatment) | TODO(verify) |
| Earth visibility fraction vs PGDA Earth-visibility map | same comparison | TODO(verify) |
| Mission replay: predicted vs reported local sunset for IM-1, Chandrayaan-3 (and SLIM, Blue Ghost 1 if used) | difference in hours, with reported time uncertainty stated | TODO(verify) |
| Apollo 11 sunlight per lunation | about 14.8 days of light | TODO(verify) |
| Horizon at a polar site vs an independent skyline (QuickMap or Moon Trek) | same ridges at the same azimuths | TODO(verify) |
| Unit tests: curvature term, ENU rotation, run-length metrics, bitset popcount vs brute force | all pass | TODO(verify) |

## Limitations and assumptions
- **Earth line of sight, not a link budget.** "Earth up" means Earth's centre is above the local skyline. It does not model antenna pattern, power, diffraction loss, DSN scheduling or relay assets. (DSN complex visibility is computed separately where shown.)
- **Representative points for Artemis regions.** NASA publishes region names and maps but no coordinates. Our points are representative picks described in `data-src/SOURCES.md`; real landing sites inside a region can differ a lot in lighting.
- **Terrain resolution.** LOLA 20 m terrain near the pole (coarser elsewhere). Boulders, small craters and metre-scale features are not resolved, and DEM errors change illumination at the margins. Uncertainty bands from PGDA error clones are planned, not built.
- **Sun-disc approximation.** Partial visibility uses a first-order area estimate, not a limb-darkened integral over the real terrain profile across the disc.
- **Spherical Moon.** Heights are relative to a 1737.4 km sphere, as in the LOLA products.
- **Time span.** Ephemeris covers 2026-2030 only. The region index covers latitudes south of 85°S only; the rest of the Moon is handled site by site.
- **Permanent shadow is a proxy.** "PSR distance" uses cells with no Sun in 2026-2030 as a proxy, not the published PSR maps. TODO(verify) wording if that changes.
- **Not modelled:** thermal state, surface charging beyond a warning badge, plume effects, vehicle and trajectory constraints, hazards at metre scale, mission availability windows.
- **Not an official NASA product.** It is a screening aid built on open NASA data and should not be used for flight decisions.
