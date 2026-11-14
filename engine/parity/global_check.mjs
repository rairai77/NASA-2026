// Global-index ranking smoke test on real data.   node global_check.mjs
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '../../web/src/engine/pkg'); const dir = path.resolve(here, '../../web/public/data');
const { initSync, Engine } = await import(path.join(pkg, 'lunar_engine.js'));
initSync({ module: fs.readFileSync(path.join(pkg, 'lunar_engine_bg.wasm')) });
const eng = new Engine();
eng.loadEphemeris(fs.readFileSync(`${dir}/ephem/ephem.json`, 'utf8'), fs.readFileSync(`${dir}/ephem/ephem.f32`));
const gm = JSON.parse(fs.readFileSync(`${dir}/global/manifest.json`, 'utf8'));
eng.loadGlobalManifest(JSON.stringify(gm));
eng.loadGlobalStatic(fs.readFileSync(`${dir}/${gm.static.file}`));
const ts = (s) => Date.parse(s + 'T00:00:00Z') / 1000;
const q = { window: { start: '2028-03-01', end: '2028-06-30' }, region: { type: 'bbox', west: -60, south: -30, east: 60, north: 30 },
  filters: [{ metric: 'slope_deg', op: '<=', value: 5 }], objectives: [{ metric: 'earth_hours', dir: 'max' }, { metric: 'sun_hours', dir: 'max' }],
  mode: 'lexicographic', k: 5, min_separation_km: 100 };
for (const m of eng.globalMonthsNeeded(ts(q.window.start), ts(q.window.end))) eng.addGlobalMonth(m, zlib.gunzipSync(fs.readFileSync(`${dir}/${gm.months.find((x) => x.month === m).file}`)));
let t = performance.now(); const rc = eng.rankCoarse(q); const tc = performance.now() - t;
for (const b of rc.bandsNeeded) eng.addGlobalHorizonBand(b, zlib.gunzipSync(fs.readFileSync(`${dir}/${gm.horizons.bands[b]}`)));
t = performance.now(); const rr = eng.rankRefine(q, rc.candidates); const tr = performance.now() - t;
console.log(JSON.stringify({ stats: rc.stats, bands: rc.bandsNeeded, coarseMs: Math.round(tc), refineMs: Math.round(tr), coarse: rr.coarse, resolutionM: rr.resolutionM,
  top: rr.results.map((r) => ({ lat: +r.lat.toFixed(2), lon: +r.lon.toFixed(2), sun: r.metrics.sun_hours, earth: r.metrics.earth_hours, slope: +r.metrics.slope_deg.toFixed(2), coarse: r.coarse })) }, null, 1));
// whole-Moon query and a polar query still use the polar index when loaded (not loaded here -> falls to global)
const g = eng.rankCoarse({ ...q, region: { type: 'global' }, filters: [] });
console.log('global considered', g.stats.considered, 'candidates', g.candidates.length);
