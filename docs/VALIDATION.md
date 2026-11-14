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
