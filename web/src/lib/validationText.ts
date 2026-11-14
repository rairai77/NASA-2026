// Copied from docs/HOW_WE_KNOW.md and docs/VALIDATION.md. Items marked TODO(verify) there are
// shown as "pending" here: never present a placeholder as a result.
export const HEADLINE = 'Sun and Earth directions match JPL Horizons to under 0.0001 degrees; skylines come from LOLA terrain with lunar curvature; limits are stated.';

export const METHODS: { h: string; t: string }[] = [
  { h: 'Sun and Earth direction', t: 'NAIF SPICE (SpiceyPy) with the DE440 ephemeris gives the Sun and Earth vectors in the Moon’s mean-Earth (MOON_ME) frame every 15 minutes for 2026–2030. A site’s east-north-up frame converts them to azimuth and elevation. Libration is included because the frame is the real, time-varying lunar orientation.' },
  { h: 'Terrain horizon', t: 'For each of 720 azimuths (360 for grid cells) we march outward over the LOLA DEM stack (20 m near the pole, 80 m, 240 m, then global 64/16/4 pixels per degree), keeping the largest elevation angle with R = 1737.4 km, including lunar curvature. No atmosphere, so no refraction. Observer height is 2 m by default.' },
  { h: 'Sun disc', t: 'The Sun is 0.53° wide, so at grazing angles it is partly hidden. Visible fraction is a first-order area estimate. For ranking, “Sun up” means a fraction of 0.5 or more.' },
  { h: 'Earth', t: 'Earth counts as up when its centre is above the horizon at its azimuth. (PGDA’s Earth-visibility maps use “any part visible”, so small differences are expected near the horizon.)' },
  { h: 'Eclipses', t: 'The Sun is partly or fully covered by Earth when the Sun–Earth separation seen from the Moon is less than the sum of their angular radii. Included in Sun visibility and in eclipse hours.' },
  { h: 'Region search', t: 'Sun-up and Earth-up bits at 3-hour steps for 1 km cells (to 85°S) are precomputed monthly; queries count bits and runs, then the top 50 candidates are recomputed at 15-minute steps with full-resolution terrain.' },
];

export const HORIZONS_ROWS: [string, string, string, string][] = [
  ['Apollo 11 (0.674 N, 23.473 E)', 'Sun', '0.00000', '0.00000'],
  ['Apollo 11', 'Earth', '0.00001', '0.00001'],
  ['Polar (−89.45, 222.69)', 'Sun', '0.00000', '0.00000'],
  ['Polar', 'Earth', '0.00000', '0.00003'],
  ['Malapert-ish (−85.99, 2.84)', 'Sun', '0.00000', '0.00000'],
  ['Malapert-ish', 'Earth', '0.00000', '0.00003'],
];
export const HORIZONS_NOTE = 'Our reference (reading the same ephemeris file) vs JPL Horizons (coord@301, airless apparent az/el), 20 times between 2026-01 and 2031-01 at three sites, site height 0 m. Worst case 3e-5° against a target of 0.05°. Horizons uses DE441, we use DE440s (negligible here). This checks geometry, not terrain. DSN spot check (2026-06-01 12:00 UTC): DSS-14 9.8121 vs 9.8122°, DSS-43 51.9189 vs 51.9189°, DSS-63 −71.6609 vs −71.6609°.';

export const TERRAIN_NOTE = 'South pole height 1290 / 1291 / 1294 m at the 20 / 80 / 240 m levels; Shackleton floor (−89.67, 129.8) about −2789 m, roughly 4.1 km below the pole; Apollo 11 −1926 m; Malapert (−85.99, 2.84) 5143 m. Level-to-level RMS differences: 20 vs 80 m 1.4 m, 80 vs 240 m 3.4 m. These show tiling and resampling are consistent (internal consistency, not independent verification).';

export const PENDING: [string, string][] = [
  ['Native Rust vs WASM parity on 20 fixed sites (horizons and window metrics)', 'target: within 1 minute and 0.01°'],
  ['Rust engine vs numpy reference vs Horizons through the engine itself', 'target: under 0.05°'],
  ['2026–2030 sunlit fraction at 20 polar cells vs PGDA average illumination (Mazarico et al. 2011)', 'target: correlation above 0.9'],
  ['Earth visibility fraction vs PGDA Earth-visibility map', 'same comparison'],
  ['Mission replay: predicted vs reported sunset for IM-1, Chandrayaan-3 (and SLIM, Blue Ghost 1)', 'difference in hours; see the Replay tab for live numbers'],
  ['Apollo 11 sunlight per lunation', 'about 14.8 days of light'],
  ['Horizon at a polar site vs an independent skyline (QuickMap or Moon Trek)', 'same ridges at the same azimuths'],
  ['Terrain heights vs published values or an independent tool', 'a few spot values'],
  ['Unit tests: curvature term, ENU rotation, run-length metrics, bitset popcount', 'all pass'],
];

export const LIMITS: string[] = [
  'Earth line of sight, not a link budget: “Earth up” means Earth’s centre is above the local skyline. No antenna pattern, power, diffraction loss, DSN scheduling or relay assets.',
  'Representative points for Artemis regions: NASA publishes region names and maps but no coordinates. Our points are representative picks; real landing sites inside a region can differ a lot in lighting.',
  'Terrain resolution: LOLA 20 m near the pole (coarser elsewhere). Boulders and metre-scale features are not resolved. Uncertainty bands are planned, not built.',
  'Sun-disc approximation: partial visibility is a first-order area estimate, not a limb-darkened integral.',
  'Spherical Moon: heights are relative to a 1737.4 km sphere, as in the LOLA products.',
  'Time span: ephemeris covers 2026–2030 only. The region index covers latitudes south of 85°S only; the rest of the Moon is handled site by site.',
  'Permanent shadow is a proxy: “PSR distance” uses cells with no Sun in 2026–2030, not the published PSR maps. The PSR layer shown on the globe is the published PGDA mask.',
  'Not modelled: thermal state, surface charging beyond a warning badge, plume effects, vehicle and trajectory constraints, metre-scale hazards, mission availability windows.',
  'Not an official NASA product. A screening aid built on open NASA data; not for flight decisions. The “NASA Artemis screening” preset is an approximation of public criteria.',
];
