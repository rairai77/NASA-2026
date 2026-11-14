// node parity_node.mjs DATA_DIR SITES_JSON T0 T1 -> JSON {id: {horizon:[...], metrics:{}, info:{}}}
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/src/engine/pkg');
const { initSync, Engine } = await import(path.join(pkg, 'lunar_engine.js'));
initSync({ module: fs.readFileSync(path.join(pkg, 'lunar_engine_bg.wasm')) });
const [dir, sitesFile, t0, t1] = process.argv.slice(2);
const eng = new Engine();
eng.loadEphemeris(fs.readFileSync(`${dir}/ephem/ephem.json`, 'utf8'), fs.readFileSync(`${dir}/ephem/ephem.f32`));
const man = JSON.parse(fs.readFileSync(`${dir}/terrain/manifest.json`, 'utf8'));
eng.loadTerrainManifest(JSON.stringify(man));
function loadTiles(keys) {
  for (const k of keys) {
    const [id, ty, tx] = k.split('/');
    if (eng.hasTile(id, +tx, +ty)) continue;
    const lvl = man.levels.find((l) => l.id === id);
    const p = `${dir}/${lvl.path.replace('{ty}', ty).replace('{tx}', tx)}`;
    if (fs.existsSync(p)) eng.addTile(id, +tx, +ty, zlib.gunzipSync(fs.readFileSync(p)));
  }
}
const out = {};
for (const s of JSON.parse(fs.readFileSync(sitesFile, 'utf8'))) {
  loadTiles(eng.requiredTiles(s.lat, s.lon, undefined, 720));
  const hz = eng.horizon(s.lat, s.lon, 2.0, 720);
  const v = eng.visibility(s.lat, s.lon, 2.0, hz.elevDeg, +t0, +t1, 900);
  out[s.id] = { horizon: Array.from(hz.elevDeg), metrics: v.metrics, info: { res: hz.resolutionM, z: hz.siteElevM, missing: hz.missingSamples }, nEvents: v.events.length };
}
console.log(JSON.stringify(out));
