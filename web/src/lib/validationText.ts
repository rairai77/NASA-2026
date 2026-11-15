// Numbers copied from docs/VALIDATION.md (run scripts named there). Keep in sync by hand; never show a placeholder as a result.
export const HEADLINE = 'Our Sun and Earth visibility agrees with NASA’s independent polar illumination maps, a replay of three real landers, and the published permanent-shadow mask; limits are stated below.';

export const HEADLINE_CARDS: { k: string; n: string; m: string; c: string }[] = [
  { k: 'NASA PGDA illumination', n: 'r = 0.976', m: 'Where we say the Sun shines, NASA’s independent polar maps agree, cell by cell.', c: '72,324 one-km cells, 85–90°S. Ours is 2026–2030, PGDA is an 18.6-year mean, so we run 0.023 lower on average (RMSE 0.039).' },
  { k: 'Mission replay', n: '3.6 h', m: 'We predicted Chandrayaan-3’s sunset 3.6 h after its reported end of operations. IM-1 +42.3 h, Blue Ghost 1 −3.4 h.', c: 'Three missions only. IM-1 was a tipped lander that died before true sunset. Reported end times are uncertain by hours.' },
  { k: 'Permanent shadow overlap', n: 'IoU 0.81', m: 'Our “never lit” cells and NASA’s published shadow mask overlap on 97.7% of cells.', c: '7,174 dark in both; 1,633 dark only in ours (shorter window, half-disc rule).' },
  { k: 'JPL Horizons ephemeris', n: '3e-5°', m: 'Sun and Earth directions match JPL Horizons to within 3e-5°, far inside the 0.05° target.', c: 'Mostly shows the SPICE data is read correctly. It checks geometry, not terrain.' },
];

export const METHODS: { h: string; t: string }[] = [
  { h: 'Sun and Earth direction', t: 'NAIF SPICE (SpiceyPy) with the DE440 ephemeris gives the Sun and Earth vectors in the Moon’s mean-Earth (MOON_ME) frame every 15 minutes for 2026–2030. A site’s east-north-up frame converts them to azimuth and elevation. Libration is included because the frame is the real, time-varying lunar orientation.' },
  { h: 'Terrain horizon', t: 'For each of 720 azimuths (360 for grid cells) we march outward over the LOLA DEM stack (20 m near the pole, 80 m, 240 m, then global 64/16/4 pixels per degree), keeping the largest elevation angle with R = 1737.4 km, including lunar curvature. No atmosphere, so no refraction. Observer height is 2 m by default.' },
  { h: 'Sun disc', t: 'The Sun is 0.53° wide, so at grazing angles it is partly hidden. Visible fraction is a first-order area estimate. For ranking, “Sun up” means a fraction of 0.5 or more.' },
  { h: 'Earth', t: 'Earth counts as up when its centre is above the horizon at its azimuth. (PGDA’s Earth-visibility maps use “any part visible”, so small differences are expected near the horizon.)' },
  { h: 'Eclipses', t: 'The Sun is partly or fully covered by Earth when the Sun–Earth separation seen from the Moon is less than the sum of their angular radii. Included in Sun visibility and in eclipse hours.' },
  { h: 'Region search', t: 'Sun-up and Earth-up bits at 3-hour steps for 1 km cells (to 85°S) are precomputed monthly; queries count bits and runs, then the top 50 candidates are recomputed at 15-minute steps with full-resolution terrain. Outside the pole, a coarser 10 km global index does the same, and its results are flagged coarse.' },
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

export const RESULTS: { h: string; t: string; src: string }[] = [
  { h: 'Engine vs JPL Horizons', t: 'The compiled engine itself (not only the Python reference) agrees with Horizons airless az/el to 3e-5° at 3 sites × 20 times (limit 0.05°).', src: 'engine/parity/horizons_check.py' },
  { h: 'Native vs WebAssembly', t: 'The browser (WASM) build and the native Rust build give bit-identical results on 20 real sites: horizon difference 0°, hours metrics 0.000 min, angle metrics 0° (limits 0.01° and 1 min).', src: 'engine/parity/run_parity.py' },
  { h: 'Sun fraction vs NASA PGDA', t: 'Over 72,324 one-km cells (85–90°S) our 2026–2030 sunlit fraction vs PGDA average illumination (Mazarico et al. 2011, LOLA): r = 0.976, bias −0.023, RMSE 0.039 (target r > 0.9). On 20 rank-spaced cells r = 0.996.', src: 'pipeline/validate_pgda.py' },
  { h: 'Earth visibility vs PGDA', t: 'r = 0.974, bias −0.049, RMSE 0.070. We run a little lower because our Earth is "up" only when its centre clears the skyline, PGDA counts any part of the disc.', src: 'pipeline/validate_pgda.py' },
  { h: 'Permanent shadow', t: 'Our "never lit" cells agree with the published PSR mask on 97.7% of cells (IoU 0.81). 7,174 cells are dark in both; 1,633 are dark only in ours (shorter time window, half-disc rule).', src: 'pipeline/validate_pgda.py' },
  { h: 'Apollo 11 sanity', t: 'Sun-up time over 12 consecutive lunations averages 353.6 h = 14.74 days (half a lunation is 354.3 h; the site horizon is slightly above flat).', src: 'engine/parity/apollo11_lunations.py' },
  { h: 'Shadow overlay vs per-pixel horizons', t: 'A 15 km patch at 19.5 m/px matches full horizon computations on 98.7% of lit/shaded pixels (mean error of lit fraction 0.013). At 58.6 m/px agreement drops to 77%, so the app uses roughly 20–30 m/px for local patches.', src: 'engine/parity/phase2_check.mjs' },
  { h: 'Comms (DSN) sanity', t: 'Comms hours never exceed Earth-up hours at 3 test sites (e.g. Apollo 11: 8,564.8 of 8,760 h). At least one of the 3 DSN complexes sees the Moon above 10° for 97.8% of steps. DSN elevations match Horizons to 1e-4°.', src: 'engine/parity/comms_check.mjs' },
  { h: 'Global index', t: 'Whole-Moon coarse index at ~10 km (1080 × 540 cells, 150 km horizons, 6 h steps). A 4-month box query ranks 64,800 cells in 0.59 s and refines 50 candidates in 0.14 s. Results from it are flagged "coarse".', src: 'pipeline/global_index.py' },
];

export const REPLAY_ROWS: [string, string, string][] = [
  ['IM-1 (Odysseus), −80.13°', '+42.3 h', 'Lander tipped on a slope with one panel lit and was not built for night, so it died before true sunset.'],
  ['Chandrayaan-3 (Vikram), −69.37°', '+3.6 h', 'Put to sleep as sunset approached; predicted sunset follows 3.6 h later.'],
  ['Blue Ghost 1, +18.56°', '−3.4 h', 'Operated about 5 h into lunar night on battery after sunset.'],
];
export const REPLAY_NOTE = 'Δ = our predicted local sunset minus the reported end of operations. SLIM, IM-2 and Hakuto-R M2 ended in landing anomalies, not sunsets, so their Δ is not a prediction error. Reported end times come from press releases (see data-src/SOURCES.md) and are uncertain by hours.';

export const NOT_YET: string[] = [
  'Horizon at a polar site vs an independent skyline (QuickMap or Moon Trek): not yet compared.',
  'Terrain heights vs an independent tool beyond the spot values above: not yet compared.',
];

export const LIMITS: string[] = [
  'Earth line of sight, not a link budget: “Earth up” means Earth’s centre is above the local skyline. DSN complex visibility is computed separately where shown, but there is no antenna pattern, diffraction loss, scheduling or relay modelling.',
  'Representative points for Artemis regions: NASA publishes region names and maps but no coordinates. Our points are representative picks; real landing sites inside a region can differ a lot in lighting.',
  'Terrain resolution: LOLA 20 m near the pole (coarser elsewhere). Boulders and metre-scale features are not resolved. No uncertainty bands yet.',
  'Sun-disc approximation: partial visibility is a first-order area estimate, not a limb-darkened integral.',
  'Spherical Moon: heights are relative to a 1737.4 km sphere, as in the LOLA products.',
  'Time span: the search index covers 2026–2030 only. The 1 km polar index covers latitudes south of 85°S; elsewhere the 10 km global index is coarse and candidates are refined site by site.',
  'Permanent shadow is a proxy: “PSR distance” uses cells with no Sun in 2026–2030, not the published PSR maps. The PSR layer shown on the globe is the published PGDA mask.',
  'Not modelled: thermal state, surface charging beyond a warning badge, plume effects, vehicle and trajectory constraints, metre-scale hazards, mission availability windows.',
  'Not an official NASA product. A screening aid built on open NASA data; not for flight decisions. The “NASA Artemis screening” preset is an approximation of public criteria.',
];
