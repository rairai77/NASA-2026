// Sanity check of DSN/comms outputs on real data.   node comms_check.mjs
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '../../web/src/engine/pkg'); const dir = path.resolve(here, '../../web/public/data');
const { initSync, Engine } = await import(path.join(pkg, 'lunar_engine.js'));
initSync({ module: fs.readFileSync(path.join(pkg, 'lunar_engine_bg.wasm')) });
const eng = new Engine();
eng.loadEphemeris(fs.readFileSync(`${dir}/ephem/ephem.json`, 'utf8'), fs.readFileSync(`${dir}/ephem/ephem.f32`));
eng.loadDsn(fs.readFileSync(`${dir}/dsn/dsn.json`, 'utf8'), fs.readFileSync(`${dir}/dsn/dsn.i16`));
const man = JSON.parse(fs.readFileSync(`${dir}/terrain/manifest.json`, 'utf8')); eng.loadTerrainManifest(JSON.stringify(man));
function load(keys) { for (const k of keys) { const [id, ty, tx] = k.split('/'); if (eng.hasTile(id, +tx, +ty)) continue; const l = man.levels.find((l) => l.id === id);
  const p = `${dir}/${l.path.replace('{ty}', ty).replace('{tx}', tx)}`; if (fs.existsSync(p)) eng.addTile(id, +tx, +ty, zlib.gunzipSync(fs.readFileSync(p))); } }
const t0 = 1772323200, t1 = t0 + 365 * 86400;
for (const [name, lat, lon] of [['apollo11', 0.67, 23.47], ['malapert_massif', -86.0, 0.0], ['shackleton ridge', -89.44, -141.8]]) {
  load(eng.requiredTiles(lat, lon, undefined, 720));
  const hz = eng.horizon(lat, lon, 2, 720);
  const v = eng.visibility(lat, lon, 2, hz.elevDeg, t0, t1, 900);
  const r = eng.visibility(lat, lon, 2, hz.elevDeg, t0, t1, 900, { relay: true });
  const n = v.t.length; let any = 0, all3 = 0, margin = [0, 0, 0];
  for (let k = 0; k < n; k++) { const m = v.dsnUp[k]; if (m) any++; if (m === 7) all3++; margin[v.linkMargin[k]]++; }
  const m = v.metrics;
  console.log(name, JSON.stringify({ earth_h: m.earth_hours, comms_h: m.comms_hours, longest_comms_h: m.longest_comms_h, marginal_h: m.marginal_hours,
    dsnAnyFrac: +(any / n).toFixed(4), allThree: +(all3 / n).toFixed(3), margin_steps: margin, comms_le_earth: m.comms_hours <= m.earth_hours,
    relay_comms_h: r.metrics.comms_hours, window_h: n * 0.25 }));
}
