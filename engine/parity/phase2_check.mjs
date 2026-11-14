// Smoke + accuracy test of shadowPatch / power / traverse on real data.
//   node phase2_check.mjs [DATA_DIR] [lat lon]
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '../../web/src/engine/pkg');
const { initSync, Engine } = await import(path.join(pkg, 'lunar_engine.js'));
initSync({ module: fs.readFileSync(path.join(pkg, 'lunar_engine_bg.wasm')) });
const dir = process.argv[2] ?? path.resolve(here, '../../web/public/data');
const lat = parseFloat(process.argv[3] ?? '-88.79'), lon = parseFloat(process.argv[4] ?? '124.5');
const eng = new Engine();
eng.loadEphemeris(fs.readFileSync(`${dir}/ephem/ephem.json`, 'utf8'), fs.readFileSync(`${dir}/ephem/ephem.f32`));
const man = JSON.parse(fs.readFileSync(`${dir}/terrain/manifest.json`, 'utf8'));
eng.loadTerrainManifest(JSON.stringify(man));
let nTiles = 0;
function load(keys) {
  for (const k of keys) {
    const [id, ty, tx] = k.split('/');
    if (eng.hasTile(id, +tx, +ty)) continue;
    const lvl = man.levels.find((l) => l.id === id);
    const p = `${dir}/${lvl.path.replace('{ty}', ty).replace('{tx}', tx)}`;
    if (fs.existsSync(p)) { eng.addTile(id, +tx, +ty, zlib.gunzipSync(fs.readFileSync(p))); nTiles++; }
  }
}
const ms = (f) => { const t = performance.now(); const r = f(); return [r, +(performance.now() - t).toFixed(1)]; };
const out = {};

// pick a time with the Sun just above the horizon
let t = 1772323200;
for (; t < 1772323200 + 30 * 86400; t += 3600) { const s = eng.sunEarthAt(lat, lon, t); if (s.sunEl > 0.6 && s.sunEl < 1.2) break; }
out.time = t; out.sun = eng.sunEarthAt(lat, lon, t);

// ---- shadow patch accuracy vs per-pixel horizons
const SIZE = +(process.env.SIZE ?? 30), PX = +(process.env.PX ?? 512);
const [keys, tPlan] = ms(() => eng.requiredTilesPatch(lat, lon, SIZE, PX));
load(keys);
const [p1, tFirst] = ms(() => eng.shadowPatch(lat, lon, SIZE, PX, t));
const [p2, tSecond] = ms(() => eng.shadowPatch(lat, lon, SIZE, PX, t + 3600));
const [p3, t1024first] = ms(() => { load(eng.requiredTilesPatch(lat, lon, 30, 1024)); return eng.shadowPatch(lat, lon, 30, 1024, t); });
const [, t1024] = ms(() => eng.shadowPatch(lat, lon, 30, 1024, t + 7200));
let lit = 0; for (let i = 0; i < PX * PX; i++) lit += p1.data[2 * i] / 255;
out.patch = { tilesPlanned: keys.length, planMs: tPlan, firstMs: tFirst, secondMs: tSecond, px1024FirstMs: t1024first, px1024Ms: t1024,
              pixelM: p1.pixelM, litFrac: lit / (PX * PX), sunAz: p1.sunAz, sunEl: p1.sunEl };
const R = 1737400;
// gnomonic inverse -> lat/lon of pixel (i,j)
const toRad = Math.PI / 180;
function pixLatLon(i, j) {
  const x = -p1.sizeM / 2 + (j + 0.5) * p1.pixelM, y = p1.sizeM / 2 - (i + 0.5) * p1.pixelM;
  const la = lat * toRad, lo = lon * toRad;
  const U = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const E = [-Math.sin(lo), Math.cos(lo), 0], N = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const v = [0, 1, 2].map((k) => U[k] + x / R * E[k] + y / R * N[k]); const n = Math.hypot(...v);
  return [Math.asin(v[2] / n) / toRad, Math.atan2(v[1], v[0]) / toRad];
}
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const N = 150; let sumAbs = 0, big = 0, nPen = 0, maxd = 0; const rows = [];
for (let n = 0; n < N; n++) {
  // bias toward lit/penumbra pixels half of the time
  let i, j, v;
  for (let tries = 0; tries < 50; tries++) { i = 20 + Math.floor(rnd() * (PX - 40)); j = 20 + Math.floor(rnd() * (PX - 40)); v = p1.data[2 * (i * PX + j)]; if (n % 2 === 0 || v > 0) break; }
  const [la, lo] = pixLatLon(i, j);
  load(eng.requiredTiles(la, lo, undefined, 720));
  const hz = eng.horizon(la, lo, 0.0, 720);
  const ref = eng.visibility(la, lo, 0.0, hz.elevDeg, t, t + 900, 900).sunFrac[0];
  // visibility at t+0 uses instant t; the patch uses the same instant
  const d = Math.abs(ref - v / 255); sumAbs += d; maxd = Math.max(maxd, d); if (d > 0.25) big++;
  rows.push([ref, v / 255]);
}
out.accuracy = { n: N, meanAbsDiff: sumAbs / N, maxAbsDiff: maxd, fracPixelsDiffGt025: big / N,
                 litAgree: rows.filter(([a, b]) => (a >= 0.5) === (b >= 0.5)).length / N };

// ---- power
load(eng.requiredTiles(lat, lon, undefined, 720));
const hz = eng.horizon(lat, lon, 2.0, 720);
const t0 = 1772323200, t1 = t0 + 30 * 86400;
const panel = { kind: 'vertical_fixed', azimuthDeg: 180, areaM2: 2, efficiency: 0.3, loadW: 50, depthOfDischarge: 0.8 };
const [pw] = ms(() => eng.power(lat, lon, 2.0, hz.elevDeg, t0, t1, 900, panel));
const pt = eng.power(lat, lon, 2.0, hz.elevDeg, t0, t1, 900, { ...panel, kind: 'vertical_tracking' });
out.fixedByAz = [0, 90, 180, 270].map((az) => Math.round(eng.power(lat, lon, 2.0, hz.elevDeg, t0, t1, 900, { ...panel, azimuthDeg: az }).energyWh));
out.power = { fixed: { energyWh: pw.energyWh, whPerDay: pw.whPerDay, batteryWhNeeded: pw.batteryWhNeeded, longestDarkH: pw.longestDarkH, survives: pw.survivesNight, peakW: Math.max(...pw.powerW) },
              tracking: { energyWh: pt.energyWh, peakW: Math.max(...pt.powerW) } };
// power metrics via rankPoints
const q = { window: { start: '2026-03-01', end: '2026-03-31' }, region: { type: 'sites', ids: ['x'] }, filters: [{ metric: 'energy_wh', op: '>', value: 0 }],
            objectives: [{ metric: 'energy_wh', dir: 'max' }], k: 3, min_separation_km: 0, power: { ...panel, kind: 'vertical_tracking' } };
const rp = eng.rankPoints(q, [{ id: 'x', lat, lon, elevDeg: hz.elevDeg }]);
out.rankPointsPower = rp.results.map((r) => ({ energy_wh: r.metrics.energy_wh, battery: r.metrics.battery_wh_needed }));

// ---- traverse
const a = { lat, lon }, b = { lat: lat + 0.12, lon };   // ~3.6 km north of the start (meridian; lon is "north" ref at the pole is complicated)
load(eng.requiredTilesTraverse(a, b));
const lim = { maxSlopeDeg: 15, speedMps: 0.5, requireSun: true, requireEarth: false, maxHours: 72 };
const [tr, tTr] = ms(() => eng.traverse(a, b, t, lim));
const [tr0, tTr0] = ms(() => eng.traverse(a, b, t, { ...lim, requireSun: false }));
out.traverse = { sun: { status: tr.status, distanceM: tr.distanceM, durationH: tr.durationS / 3600, sunlitFrac: tr.sunlitFrac, earthFrac: tr.earthFrac, points: tr.path.length, ms: tTr, px: tr.px, cellM: tr.cellM },
                 noSunConstraint: { status: tr0.status, distanceM: tr0.distanceM, durationH: tr0.durationS / 3600, sunlitFrac: tr0.sunlitFrac, ms: tTr0 } };
out.tilesLoaded = nTiles;
console.log(JSON.stringify(out, null, 1));
