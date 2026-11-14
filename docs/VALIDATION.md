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

Result: not yet run (the index `static.f32` did not exist when this was written). Run
`cd pipeline && uv run python validate_pgda.py`; it prints the table and writes `pipeline/work/pgda_compare.json`.
Target: r > 0.9 for both quantities. Replace this paragraph with the numbers.

The same data feeds the globe layers (`pipeline/layers.py`), which also use Diviner annual maximum surface and
average (2 cm) temperature from the LRO Diviner Polar Resource Product (75-90S, ~500 m triangle mesh). Spot check:
Shackleton floor Tmax 85.5 K, Tavg 52 K (PSR cold trap); Malapert Tmax 243 K.
