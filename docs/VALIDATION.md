## Ephemeris

`pipeline/validate_ephem.py` compares `pipeline/reference/sky.py` (topocentric az/el of the Sun and Earth
from `ephem.f32`, CONTRACTS §7: `v = B - P`, linear interpolation in time, ENU basis, geometric elevation)
against JPL Horizons (`CENTER='coord@301'`, geodetic site coordinates, `QUANTITIES=4` airless apparent az/el),
20 times between 2026-01 and 2031-01 at three sites, site height 0 m above the 1737.4 km sphere.

Horizons' lunar body-fixed frame for `coord@301` is `MEAN_ME (high precision)` with a 1737.4 km sphere,
so "altitude" is above that sphere and the frame matches `MOON_ME` from `moon_de440_250416.tf`
(MOON_ME_DE440_ME421). Horizons uses DE441, we use DE440s; the difference is negligible here.

| site | body | max abs(d_az * cos el) (deg) | max abs(d_el) (deg) |
|---|---|---|---|
| Apollo 11 (0.674 N, 23.473 E) | Sun | 0.00000 | 0.00000 |
| Apollo 11 | Earth | 0.00001 | 0.00001 |
| polar (-89.45, 222.69) | Sun | 0.00000 | 0.00000 |
| polar | Earth | 0.00000 | 0.00003 |
| Malapert-ish (-85.99, 2.84) | Sun | 0.00000 | 0.00000 |
| Malapert-ish | Earth | 0.00000 | 0.00003 |

Worst case 3e-5 deg (target < 0.05). A run with site height 2000 m also agrees to 3e-5 deg, so height is handled.
The 15-minute linear interpolation contributes at most ~3e-5 deg for Earth.

DSN elevations (`pipeline/dsn.py`) were spot-checked against Horizons (`coord@399`, station geodetic
position from the station SPK, `QUANTITIES=4`) at 2026-06-01 12:00 UTC: DSS-14 9.8121 vs 9.8122 deg,
DSS-43 51.9189 vs 51.9189 deg, DSS-63 -71.6609 vs -71.6609 deg.

## Terrain tiles

Checked by `python -m reference.terrain` (from `pipeline/`): south pole height 1290 / 1291 / 1294 m in
s0 / s1 / s2; Shackleton floor (-89.67, 129.8) -2789 / -2788 / -2786 m (s0/s1/s2), -2778 m in g0 (about -4.1 km
relative to the pole); Apollo 11 -1926 m (g0); Malapert (-85.99, 2.84) 5143 m (s0/s1). Level-to-level RMS
differences: s0-s1 1.4 m, s1-s2 3.4 m, s1-g0 10.8 m, g0-g1 49 m (resolution differences).

## PGDA comparison

Reference: NASA PGDA product 69 (Mazarico et al. 2011), LOLA-derived 240 m south polar maps (65-90S, polar
stereographic on the 1737.4 km sphere, identical to CONTRACTS south_stereo): `AVGVISIB_65S_240M_201608` (average
solar illumination, fraction, 18.6-year mean of hourly steps), `..._EARTH` (average Earth visibility) and
`LPSR_65S_240M_201608` (permanent shadow mask). Orientation checked: Shackleton floor (-89.67, 129.8) has
illumination 0, Earth visibility 0, PSR = 1; Malapert (-85.99, 2.84) has illumination 0.52, Earth 0.91.

Method (`pipeline/validate_pgda.py`): PGDA is sampled bilinearly at the centres of our 304 x 304 1 km grid cells
(valid if lat <= -85, 72,324 cells) and stored in `pipeline/work/pgda_grid.npz` (`illum`, `earthvis`, `psr`; PSR is the
bilinear mask fraction, compared at >= 0.5). Against the index `static.f32` we report, over all valid cells and over
20 cells chosen at evenly spaced ranks of the PGDA value: Pearson r of `sun_frac_5yr` vs PGDA illumination and of
`earth_frac_5yr` vs PGDA Earth visibility, mean bias (ours - PGDA), RMSE, and agreement of
`sun_frac_5yr == 0` with PGDA PSR (counts, overall agreement, IoU).

Expected differences, so a bias of a few percent is not a bug:
- Our window is 2026-2030 (5 years, 3 h steps); PGDA averages the full ~18.6-year nutation cycle hourly. Sun-up
  fractions near the pole vary by several percent between years.
- Our Sun is "up" only if at least 50 % of the disc is visible; PGDA integrates the fractional disc, so a limb
  grazing a ridge counts partially there and not at all here (a little lower for us on marginal cells).
- Our Earth is "up" if the disc centre is above the horizon; PGDA counts Earth visible if any part of its disc shows
  (slightly higher for PGDA).
- Our PSR proxy (`sun_frac_5yr == 0` at 1 km cell centres, heights from the 20 m DEM at 2 m) is a point test, PGDA PSR
  is a 240 m mask of cells never lit over the cycle, so small cold traps inside a cell differ.
- Different DEM generations and sampling (cell centre vs 240 m pixel, bilinear).

Result (72,324 valid 1 km cells, 85-90°S; target r > 0.9):

| quantity | Pearson r (all cells) | r (20 rank-spaced cells) | mean ours / PGDA | bias (ours - PGDA) | RMSE |
|---|---|---|---|---|---|
| Sun (our sun_frac_5yr vs PGDA avg. illumination) | 0.976 | 0.996 | 0.196 / 0.220 | -0.023 | 0.039 |
| Earth (our earth_frac_5yr vs PGDA avg. Earth visibility) | 0.974 | 0.988 | 0.216 / 0.264 | -0.049 | 0.070 |

PSR: 7,174 cells are permanently dark in both; 1,633 are dark only in ours (2026-2030 window is shorter than PGDA's
cycle, and our Sun-up needs half the disc), 48 only in PGDA. Agreement 97.7%, IoU 0.81. Our values run slightly
lower than PGDA, as expected from the stricter Sun (half disc) and Earth (centre, not any part) definitions.
Reproduce: `cd pipeline && uv run python validate_pgda.py` (writes `pipeline/work/pgda_compare.json`).

The same data feeds the globe layers (`pipeline/layers.py`), which also use Diviner annual maximum surface and
average (2 cm) temperature from the LRO Diviner Polar Resource Product (75-90S, ~500 m triangle mesh). Spot check:
Shackleton floor Tmax 85.5 K, Tavg 52 K (PSR cold trap); Malapert Tmax 243 K.

## Engine (Rust) validation

Scripts live in `engine/parity/`; run them with `pipeline/.venv/bin/python` (it has the `lunar_engine` wheel) and, for
the WASM side, after `scripts/build-wasm.sh`.

**Engine vs JPL Horizons** (`horizons_check.py`): `Engine.sun_earth_at` (observer on the 1737.4 km sphere, height 0)
against Horizons airless apparent az/el (`CENTER='coord@301'`, `QUANTITIES=4`), 3 sites (Apollo 11, polar
-89.45/222.69, Malapert-ish -85.99/2.84) x 20 times 2026-2030, Sun and Earth. Max |daz*cos(el)| and max |del| over all
rows: 3e-5 deg (limit 0.05 deg). PASS.

**Native vs WASM** (`run_parity.py`): 20 sites (12 polar from `sites.json` incl. IM-1/2, Chandrayaan-3, Artemis III
regions and Shackleton/de Gerlache ridges, plus Apollo 11/12/14/15/16/17, SLIM, Chang'e 4), real tiles, 720-az horizon
at h = 2 m and 900 s visibility metrics over 2026-03-01..03-31, Python wheel vs `wasm` in Node. Max difference:
horizon 0 deg, hours metrics 0.000 min, angle metrics 0 deg (bit-identical; limits 0.01 deg and 1 min). PASS.

**Apollo 11 sanity** (`apollo11_lunations.py`): Sun-up hours over 12 consecutive synodic lunations (29.5306 d) from
2026-01-01: 353.2, 353.5, 350.8, 354.2, 354.8, 355.0, 355.0, 354.8, 351.2, 354.2, 353.8, 353.2; mean 353.6 h = 14.74 d
(half a lunation is 354.3 h; the horizon at the site is slightly above flat). PASS.

**Shadow patch vs per-pixel horizons** (`phase2_check.mjs`, ridge at -88.79/124.5, Sun 0.6 deg above the centre
horizon, 150 random pixels, reference = full 720-az horizon + visibility per pixel): with a 15 km patch at 768 px
(19.5 m, same as the DEM) mean |diff| of the visible fraction 0.013, lit/shaded agreement 98.7 %. With a 30 km patch at
512 px (58.6 m) the agreement falls to 77 % (mean |diff| 0.23): terrain is under-sampled and narrow shadows alias, so use
pixels of about 20-30 m for local patches. Timing in WASM (Node, single thread, 1024 px, 30 km): first call incl. height
grid 200 ms, later times ~95 ms; 512 px ~32 ms.

**Comms / DSN sanity** (`engine/parity/comms_check.mjs`, one year from 2026-03-01, 900 s steps): `comms_hours <= earth_hours`
at all 3 test sites (Apollo 11: 8564.8 of 8760 Earth hours, Malapert massif 2826.5 of 2842.8, Shackleton ridge 1138.8 of
1147.0). At least one of the 3 DSN complexes has the Moon >= 10 deg for 97.8 % of steps (the gaps are the only difference
between comms and Earth hours). `relay: true` gives comms hours = window hours. Marginal-link hours (Earth centre within
1.5 deg above the skyline): Apollo 11 0, Malapert massif 668 h, Shackleton ridge 1147 h (all its Earth time is marginal).

**Global index** (`pipeline/global_index.py`, `engine/parity/global_check.mjs`): 1080 x 540 cells (3/deg, ~10 km), 72 az,
150 km, 6 h steps, 68 files, largest 13.3 MiB. Build: horizons 217 s + bitsets for 60 months 183 s on 4 contended cores.
A 4-month bbox query (-60..60 E, -30..30 N, slope <= 5 deg): rankCoarse 0.59 s over 64,800 cells and rankRefine of 50
candidates 0.14 s in WASM (Node); whole-Moon unfiltered coarse pass over 583,200 cells works. Results are flagged `coarse`.

**Mission replay** (`pipeline/missions_pred.py` → `data/missions_pred.json`; horizon from the finest DEM covering each
site, 15-min steps). Delta = our predicted local sunset (Sun fraction 0.5 against the terrain horizon) minus the reported
end of operations from press releases (`data-src/SOURCES.md`, uncertain by hours). Read this as a consistency check, not a
sunset test: Chandrayaan-3 and Blue Ghost 1 shut down within 4 h of our predicted sunset, but a shutdown is an operator or
battery decision. IM-1 is shown for completeness only and is not comparable:

| Mission | Lat | DEM | Reported end | Predicted sunset | Delta | Reading |
|---|---|---|---|---|---|---|
| IM-1 (Odysseus) | -80.13 | 80 m | 2024-02-29 17:00 | 2024-03-02 11:16 | +42.3 h | tipped lander, one panel lit, died before true sunset |
| Chandrayaan-3 (Vikram) | -69.37 | 240 m | 2023-09-04 02:30 | 2023-09-04 06:03 | +3.6 h | put to sleep as sunset approached |
| Blue Ghost 1 | +18.56 | 474 m | 2025-03-16 23:15 | 2025-03-16 19:49 | -3.4 h | ran about 5 h into the night on battery |

Blue Ghost 1 also saw the 2025-03-14 total eclipse of the Sun by Earth; the engine's eclipse-aware prediction marks that
dark period (2025-03-14 05:40 UTC) separately from sunset. SLIM, IM-2 and Hakuto-R M2 ended in landing anomalies, so
their deltas (+275 h, +302 h, +313 h) are not prediction errors; the same goes for IM-1's +42.3 h.
