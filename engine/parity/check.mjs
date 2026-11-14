// Native/WASM parity helper. Loads the wasm pkg in Node, feeds it a pipeline data
// dir (terrain tiles on demand via requiredTiles, ephemeris, optional index) and
// prints JSON results to compare against the Python/native engine.
//   node check.mjs DATA_DIR [lat lon]
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '../../web/src/engine/pkg');
const { initSync, Engine } = await import(path.join(pkg, 'lunar_engine.js'));
initSync({ module: fs.readFileSync(path.join(pkg, 'lunar_engine_bg.wasm')) });

const dir = process.argv[2];
const lat = parseFloat(process.argv[3] ?? '-89.5');
const lon = parseFloat(process.argv[4] ?? '20');
const eng = new Engine();
eng.loadEphemeris(fs.readFileSync(`${dir}/ephem/ephem.json`, 'utf8'), fs.readFileSync(`${dir}/ephem/ephem.f32`));
const man = JSON.parse(fs.readFileSync(`${dir}/terrain/manifest.json`, 'utf8'));
eng.loadTerrainManifest(JSON.stringify(man));

function loadTiles(keys) {
  let n = 0;
  for (const k of keys) {
    const [id, ty, tx] = k.split('/');
    if (eng.hasTile(id, +tx, +ty)) continue;
    const lvl = man.levels.find((l) => l.id === id);
    const p = `${dir}/${lvl.path.replace('{ty}', ty).replace('{tx}', tx)}`;
    if (!fs.existsSync(p)) continue;
    eng.addTile(id, +tx, +ty, zlib.gunzipSync(fs.readFileSync(p)));
    n++;
  }
  return n;
}

let t = performance.now();
const keys = eng.requiredTiles(lat, lon, undefined, 720);
const nTiles = loadTiles(keys);
const tPlan = performance.now() - t;
t = performance.now();
const hz = eng.horizon(lat, lon, 2.0, 720);
const tHz = performance.now() - t;
const t0 = 1769904000 + 5 * 86400;
t = performance.now();
const vis = eng.visibility(lat, lon, 2.0, hz.elevDeg, t0, t0 + 15 * 86400, 900);
const tVis = performance.now() - t;
const out = {
  site: { lat, lon },
  requiredTiles: keys.length,
  tilesLoaded: nTiles,
  horizon: { resolutionM: hz.resolutionM, siteElevM: hz.siteElevM, missing: hz.missingSamples, first: Array.from(hz.elevDeg.slice(0, 4)),
             max: Math.max(...hz.elevDeg), min: Math.min(...hz.elevDeg) },
  metrics: vis.metrics,
  events: vis.events.slice(0, 6),
  sunEarthAt: eng.sunEarthAt(lat, lon, t0),
  heights: Array.from(eng.sampleHeights(-30, -89.9, 30, -89.5, 3, 2)),
  ms: { plan: tPlan, horizon: tHz, visibility: tVis },
};

// ellipse (needs tiles around the site)
loadTiles(eng.requiredTilesArea(lat, lon, 3));
t = performance.now();
const ell = eng.ellipse(lat, lon, 200, 100, 30, 16, 2.0, t0, t0 + 10 * 86400, 900);
out.ellipse = { n: ell.points.length, sun_hours: ell.summary.sun_hours, ms: performance.now() - t };

// index ranking (optional)
if (fs.existsSync(`${dir}/index/manifest.json`)) {
  const im = JSON.parse(fs.readFileSync(`${dir}/index/manifest.json`, 'utf8'));
  eng.loadIndexManifest(JSON.stringify(im));
  eng.loadIndexStatic(fs.readFileSync(`${dir}/index/${im.static.file.replace('index/', '')}`));
  const q = {
    window: { start: '2026-02-05', end: '2026-03-10' },
    region: { type: 'polar', min_lat: -90, max_lat: -85 },
    filters: [{ metric: 'slope_deg', op: '<=', value: 12 }],
    objectives: [{ metric: 'earth_hours', dir: 'max' }, { metric: 'sun_hours', dir: 'max' }],
    mode: 'lexicographic', weights: null, k: 5, min_separation_km: 8,
  };
  const need = eng.indexMonthsNeeded(Date.parse('2026-02-05T00:00:00Z') / 1000, Date.parse('2026-03-10T00:00:00Z') / 1000);
  for (const m of need) {
    const f = im.months.find((x) => x.month === m).file;
    eng.addIndexMonth(m, fs.readFileSync(`${dir}/${f.replace(/\.gz$/, '')}`));
  }
  try { eng.rankCoarse(q); } catch (e) { out.missingBandError = String(e.message ?? e); }
  t = performance.now();
  const rc = eng.rankCoarse.length >= 0 && (() => {
    for (let b = 0; b < im.horizons.bands.length; b++) eng.addHorizonBand(b, fs.readFileSync(`${dir}/${im.horizons.bands[b]}`));
    return eng.rankCoarse(q);
  })();
  const tCoarse = performance.now() - t;
  t = performance.now();
  const rr = eng.rankRefine(q, rc.candidates);
  out.rank = { coarseStats: rc.stats, nCandidates: rc.candidates.length, bandsNeeded: rc.bandsNeeded, tCoarseMs: tCoarse, tRefineMs: performance.now() - t,
               top: rr.results.map((r) => ({ rank: r.rank, cell: r.cell, lat: +r.lat.toFixed(3), lon: +r.lon.toFixed(2), earth: r.metrics.earth_hours, sun: r.metrics.sun_hours,
                       cEarth: r.coarseMetrics.earth_hours, cSun: r.coarseMetrics.sun_hours })),
               passed: rr.passedFilters, model: rr.model, resolutionM: rr.resolutionM };
  // bad query errors cleanly
  try { eng.rankCoarse({ ...q, window: { start: '2035-01-01', end: '2035-02-01' } }); } catch (e) { out.badWindowError = String(e.message ?? e); }
  // points
  const pts = [{ id: 'siteA', lat, lon, elevDeg: hz.elevDeg, siteElevM: hz.siteElevM }];
  out.points = eng.rankPoints({ ...q, region: { type: 'sites', ids: ['siteA'] }, filters: [] }, pts).results.map((r) => ({ id: r.id, sun: r.metrics.sun_hours }));
}
console.log(JSON.stringify(out, null, 1));
