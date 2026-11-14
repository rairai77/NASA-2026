// Engine Web Worker. Owns the wasm Engine (when available), all data fetching
// (Cache API + in-memory), and exposes EngineApi through Comlink.
// If ./pkg (wasm-pack output) or /data/ephem/ephem.json is missing we fall back to MockEngine.
import * as Comlink from 'comlink';
import type {
  CuratedSite, EllipseArgs, EllipseResult, EngineApi, HorizonResult, InitInfo, Mission, Progress,
  Panel, PowerResult, Query, RankResult, ShadowPatch, Site, SunEarth, TraverseLimits, TraverseResult, VisResult,
} from './api.ts';
import { regionIsCoarse } from '../query/query.ts';
import { loadFaults, loadMissions, loadSites, fetchJsonMaybe } from './catalog.ts';
import { MockEngine, parseWhen } from './mock.ts';
import { perfLog, PERF } from './perf.ts';

// import.meta.glob resolves to {} when the pkg has not been generated yet, so the build
// never breaks on the missing module; once pkg exists it is bundled (lazy chunk).
const pkgLoaders = import.meta.glob('./pkg/lunar_engine.js') as Record<string, () => Promise<WasmModule>>;

interface WasmEngine {
  loadEphemeris(metaJson: string, bytes: Uint8Array): void;
  loadTerrainManifest(json: string): void;
  addTile(levelId: string, tx: number, ty: number, raw: Uint8Array): void;
  hasTile(levelId: string, tx: number, ty: number): boolean;
  requiredTiles(lat: number, lon: number, maxDistKm: number | undefined, nAz: number): string[];
  requiredTilesArea(lat: number, lon: number, radiusKm: number, levelId?: string): string[];
  requiredTilesRect(west: number, south: number, east: number, north: number, w: number, h: number): string[];
  horizon(lat: number, lon: number, heightM: number, nAz: number): HorizonResult;
  visibility(lat: number, lon: number, heightM: number, elevDeg: Float32Array, tStart: number, tEnd: number, stepS: number, opts?: { relay?: boolean }): VisResult;
  loadDsn(metaJson: string, bytes: Uint8Array): void;
  loadGlobalManifest(json: string): void;
  loadGlobalStatic(raw: Uint8Array): void;
  addGlobalMonth(month: string, raw: Uint8Array): void;
  addGlobalHorizonBand(band: number, raw: Uint8Array): void;
  globalMonthsNeeded(tStart: number, tEnd: number): string[];
  power(lat: number, lon: number, heightM: number, elevDeg: Float32Array, tStart: number, tEnd: number, stepS: number, panel: Panel): PowerResult;
  requiredTilesTraverse(start: { lat: number; lon: number }, goal: { lat: number; lon: number }, cellM?: number | null): string[];
  traverse(start: { lat: number; lon: number }, goal: { lat: number; lon: number }, tStart: number, limits: TraverseLimits, cellM?: number | null): TraverseResult;
  loadIndexManifest(json: string): void;
  loadIndexStatic(raw: Uint8Array): void;
  addIndexMonth(month: string, raw: Uint8Array): void;
  addHorizonBand(band: number, raw: Uint8Array): void;
  indexMonthsNeeded(tStart: number, tEnd: number): string[];
  rankCoarse(query: Query): { candidates: unknown[]; bandsNeeded: number[]; stats?: { considered?: number; passedFilters?: number } };
  rankRefine(query: Query, candidates: unknown[]): RankResult;
  rankPoints(query: Query, points: { id: string; lat: number; lon: number; elevDeg: Float32Array }[]): RankResult;
  ellipse(lat: number, lon: number, a: number, b: number, rot: number, n: number, h: number, tS: number, tE: number, stepS: number): EllipseResult;
  sampleHeights(w: number, s: number, e: number, n: number, nw: number, nh: number): Float32Array;
  sunEarthAt(lat: number, lon: number, t: number): SunEarth;
  shadowPatch?(lat: number, lon: number, sizeKm: number, px: number, t: number): unknown;
  requiredTilesPatch?(lat: number, lon: number, sizeKm: number, px: number): string[];
  threads?: () => number;
}
interface WasmModule {
  default: (arg?: unknown) => Promise<unknown>;
  Engine: new () => WasmEngine;
  initThreadPool?: (n: number) => Promise<void>;
}

interface TerrainLevel { id: string; path: string; missing?: string[] }
interface TerrainManifest { levels: TerrainLevel[] }
interface IndexManifest {
  months: { month: string; file: string }[];
  horizons: { bands: string[] };
  static: { file: string };
}

// ---------------------------------------------------------------------------------------
// Data fetching: in-memory map + Cache API, gunzip via DecompressionStream
// ---------------------------------------------------------------------------------------
let CACHE_NAME = 'lunar-data-v1';
declare const __BUILD_TIME__: string;

function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Cache name = data version: data/version.json if present, else a hash of the terrain manifest + ephemeris
 *  header, else the build time. Old 'lunar-data-*' caches are deleted. */
async function setupCache(base: string): Promise<string> {
  const txt = async (p: string) => {
    try {
      const r = await fetch(`${base}data/${p}`, { cache: 'no-cache' });
      return r.ok && !(r.headers.get('content-type') ?? '').includes('html') ? await r.text() : null;
    } catch { return null; }
  };
  const v = await txt('version.json');
  let version: string;
  if (v) version = fnv(v);
  else {
    const [a, b] = await Promise.all([txt('terrain/manifest.json'), txt('ephem/ephem.json')]);
    version = a || b ? fnv((a ?? '') + (b ?? '')) : `b${fnv(typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '0')}`;
  }
  CACHE_NAME = `lunar-data-${version}`;
  try {
    for (const k of await caches.keys()) if (k.startsWith('lunar-data-') && k !== CACHE_NAME) await caches.delete(k);
  } catch { /* Cache API unavailable */ }
  return version;
}
const mem = new Map<string, Promise<Uint8Array | null>>();
/** Fetch Priority hint for this worker's requests: the terrain worker asks for 'high', the shadow worker 'low'. */
let fetchPriority: 'auto' | 'high' | 'low' = 'auto';

async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Fetch raw bytes (no gunzip). Returns null when the file is absent. */
async function fetchRaw(url: string): Promise<ArrayBuffer | null> {
  let cache: Cache | undefined;
  // no persistent cache in dev: data files change while the pipeline is still running
  if (!import.meta.env.DEV) { try { cache = await caches.open(CACHE_NAME); } catch { /* Cache API unavailable */ } }
  try {
    const hit = await cache?.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch { /* ignore */ }
  const res = await fetch(url, { priority: fetchPriority });
  if (!res.ok) return null;
  if ((res.headers.get('content-type') ?? '').includes('text/html')) return null; // SPA fallback => absent
  const buf = await res.arrayBuffer();
  try { await cache?.put(url, new Response(buf.slice(0), { headers: { 'content-type': 'application/octet-stream' } })); } catch { /* quota */ }
  return buf;
}

/** Cached, de-duplicated fetch; *.gz files are gunzipped. null if absent/corrupt. */
function getBytes(url: string, retain = true): Promise<Uint8Array | null> {
  let p = mem.get(url);
  if (!p) {
    p = (async () => {
      try {
        const buf = await fetchRaw(url);
        if (!buf) return null;
        if (!url.endsWith('.gz')) return new Uint8Array(buf);
        const u8 = new Uint8Array(buf);
        // Some servers (e.g. Vite dev) add Content-Encoding: gzip to *.gz, so the browser has
        // already inflated it. Only gunzip when the gzip magic number is still present.
        return u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b ? await gunzip(buf) : u8;
      } catch (e) {
        console.warn('[engine] fetch failed', url, e);
        return null;
      }
    })();
    mem.set(url, p);
    // Terrain tiles are copied into wasm memory by addTile; keeping a second JS copy would double their footprint.
    p.then((v) => { if (v === null) mem.delete(url); }).catch(() => mem.delete(url));
    if (!retain) p.then(() => setTimeout(() => mem.delete(url), 2000)); // short window so concurrent callers share one fetch
  }
  return p;
}

async function mapLimit<T>(items: T[], limit: number, fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------------------
// Real engine wrapper
// ---------------------------------------------------------------------------------------
class RealEngine implements EngineApi {
  private eng!: WasmEngine;
  private wasmMem?: WebAssembly.Memory;
  private tilesAdded = 0;
  private role: 'full' | 'terrain' | 'shadow' = 'full';
  private tilePending = new Map<string, Promise<void>>();
  private base = '/';
  private terrain: TerrainManifest | null = null;
  private index: IndexManifest | null = null;
  private indexReady?: Promise<boolean>;
  private globalReady?: Promise<IndexManifest | null>;
  private dsnLoaded = false;
  private mock = new MockEngine();
  private notes: string[] = [];
  private curatedP?: Promise<Record<string, CuratedSite>>;

  /** Returns null when the real engine can't start (so the caller falls back to mock). */
  async tryInit(baseUrl: string, role: 'full' | 'terrain' | 'shadow' = 'full'): Promise<InitInfo | null> {
    this.base = baseUrl;
    this.role = role;
    fetchPriority = role === 'terrain' ? 'high' : role === 'shadow' ? 'low' : 'auto';
    const tInit = performance.now();
    const loader = pkgLoaders['./pkg/lunar_engine.js'];
    // Load + compile + instantiate the wasm while the cache name / data version is being resolved.
    const wasmP = loader ? loader().then(async (m) => ({ mod: m, out: (await m.default()) as { memory?: WebAssembly.Memory } | undefined })).catch((error: unknown) => ({ error })) : null;
    await setupCache(baseUrl);
    if (!loader) { this.notes.push('wasm pkg not built (web/src/engine/pkg missing)'); return null; }
    // The terrain worker only samples heights: no ephemeris, DSN table or catalogs needed.
    const needEphem = role !== 'terrain';
    const ephemMeta = needEphem ? await getBytes(`${baseUrl}data/ephem/ephem.json`) : new Uint8Array(0);
    const ephemBin = needEphem ? await getBytes(`${baseUrl}data/ephem/ephem.f32`) : new Uint8Array(0);
    if (!ephemMeta || !ephemBin) { this.notes.push('/data/ephem/ephem.json missing'); return null; }
    try {
      const w = await wasmP!;
      if ('error' in w) throw w.error;
      const { mod, out } = w;
      this.wasmMem = out?.memory;
      this.eng = new mod.Engine();
      if (needEphem) this.eng.loadEphemeris(new TextDecoder().decode(ephemMeta), ephemBin);
    } catch (e) {
      this.notes.push(`wasm init failed: ${(e as Error).message}`);
      console.warn('[engine] wasm init failed', e);
      return null;
    }
    const tm = await getBytes(`${baseUrl}data/terrain/manifest.json`);
    if (tm) {
      this.terrain = JSON.parse(new TextDecoder().decode(tm));
      this.eng.loadTerrainManifest(new TextDecoder().decode(tm));
    } else this.notes.push('terrain manifest missing: horizons use demo terrain');
    const meta = needEphem ? JSON.parse(new TextDecoder().decode(ephemMeta)) : {};
    // real comms: DSN Moon-elevation table on the ephemeris grid (1.7 MB)
    if (role === 'full') try {
      const dm = await getBytes(`${baseUrl}data/dsn/dsn.json`);
      const db = await getBytes(`${baseUrl}data/dsn/dsn.i16`);
      if (dm && db) { this.eng.loadDsn(new TextDecoder().decode(dm), db); this.dsnLoaded = true; }
      else this.notes.push('DSN table missing: comms metrics assume Earth in view only');
    } catch (e) { this.notes.push(`DSN load failed: ${(e as Error).message}`); }
    if (role === 'full') await this.mock.init(baseUrl);
    perfLog('worker.init', performance.now() - tInit, { role });
    return {
      threads: self.navigator.hardwareConcurrency ?? 1,
      crossOriginIsolated: self.crossOriginIsolated === true,
      dataVersion: `${meta.start_utc ?? '?'}..${meta.end_utc ?? '?'}`, mode: 'wasm', dsn: this.dsnLoaded, notes: this.notes,
    };
  }

  async init(baseUrl: string): Promise<InitInfo> {
    const r = await this.tryInit(baseUrl);
    if (!r) throw new Error('real engine unavailable');
    return r;
  }

  sites(): Promise<Site[]> { return loadSites(this.base); }
  missions(): Promise<Mission[]> { return loadMissions(this.base); }
  faults() { return loadFaults(this.base); }
  curated(): Promise<Record<string, CuratedSite>> {
    return (this.curatedP ??= fetchJsonMaybe<Record<string, CuratedSite>>(`${this.base}data/curated.json`).then((c) => c ?? {}));
  }

  // ---- tiles -------------------------------------------------------------------------
  private tilePath(levelId: string, tx: number, ty: number): string | null {
    const lvl = this.terrain?.levels.find((l) => l.id === levelId);
    if (!lvl) return null;
    if (lvl.missing?.includes(`${tx},${ty}`)) return null;
    return `${this.base}data/${lvl.path.replace('{ty}', String(ty)).replace('{tx}', String(tx))}`;
  }

  /** keys look like "s0/ty/tx" */
  private async ensureTiles(keys: string[], onProgress?: (p: Progress) => void): Promise<void> {
    if (!this.terrain) return;
    const todo = keys.map((k) => {
      const [lvl, ty, tx] = k.split('/');
      return { lvl, tx: Number(tx), ty: Number(ty) };
    }).filter((t) => !this.eng.hasTile(t.lvl, t.tx, t.ty));
    let done = 0;
    await mapLimit(todo, this.role === 'full' ? 8 : 16, async (t) => {
      const key = `${t.lvl}/${t.ty}/${t.tx}`;
      let p = this.tilePending.get(key);
      if (!p) {
        p = (async () => {
          const path = this.tilePath(t.lvl, t.tx, t.ty);
          if (!path) return;
          const raw = await getBytes(path, false);
          if (raw && !this.eng.hasTile(t.lvl, t.tx, t.ty)) { try { this.eng.addTile(t.lvl, t.tx, t.ty, raw); this.tilesAdded++; } catch (e) { console.warn('[engine] addTile', e); } }
        })().finally(() => this.tilePending.delete(key));
        this.tilePending.set(key, p);
      }
      await p;
      onProgress?.({ stage: 'Loading terrain tiles', done: ++done, total: todo.length });
    });
  }

  /** Dev: wasm linear memory and tile count of this worker. */
  memInfo(): { wasmMB: number; tiles: number } {
    return { wasmMB: Math.round(((this.wasmMem?.buffer.byteLength ?? 0) / 1048576) * 10) / 10, tiles: this.tilesAdded };
  }

  async horizon(lat: number, lon: number, heightM = 2): Promise<HorizonResult> {
    if (!this.terrain) return this.mock.horizon(lat, lon, heightM);
    await this.ensureTiles(this.eng.requiredTiles(lat, lon, undefined, 720));
    return this.eng.horizon(lat, lon, heightM, 720);
  }

  async visibility(lat: number, lon: number, tStart: number, tEnd: number, opts?: { heightM?: number; stepS?: number; elevDeg?: Float32Array; relay?: boolean }): Promise<VisResult> {
    const h = opts?.heightM ?? 2;
    const elev = opts?.elevDeg ?? (await this.horizon(lat, lon, h)).elevDeg;
    return this.eng.visibility(lat, lon, h, elev, tStart, tEnd, opts?.stepS ?? 900, { relay: opts?.relay === true });
  }

  async power(lat: number, lon: number, tStart: number, tEnd: number, panel: Panel, opts?: { heightM?: number; stepS?: number; elevDeg?: Float32Array }): Promise<PowerResult> {
    const h = opts?.heightM ?? 2;
    const elev = opts?.elevDeg ?? (await this.horizon(lat, lon, h)).elevDeg;
    return this.eng.power(lat, lon, h, elev, tStart, tEnd, opts?.stepS ?? 900, panel);
  }

  async traverse(start: { lat: number; lon: number }, goal: { lat: number; lon: number }, tStart: number, limits: TraverseLimits, cellM?: number): Promise<TraverseResult> {
    await this.ensureTiles(this.eng.requiredTilesTraverse(start, goal, cellM ?? null));
    return this.eng.traverse(start, goal, tStart, limits, cellM ?? null);
  }

  async compare(points: { id: string; lat: number; lon: number }[], tStart: number, tEnd: number) {
    const out: Record<string, VisResult> = {};
    for (const p of points) out[p.id] = await this.visibility(p.lat, p.lon, tStart, tEnd);
    return out;
  }

  // ---- ranking -----------------------------------------------------------------------
  private async ensureIndex(): Promise<boolean> {
    return (this.indexReady ??= (async () => {
      const m = await getBytes(`${this.base}data/index/manifest.json`);
      const st = m && JSON.parse(new TextDecoder().decode(m)) as IndexManifest;
      if (!m || !st) { this.notes.push('index manifest missing: rank uses demo data'); return false; }
      const stat = await getBytes(`${this.base}data/${st.static.file}`);
      if (!stat) return false;
      this.eng.loadIndexManifest(new TextDecoder().decode(m));
      this.eng.loadIndexStatic(stat);
      this.index = st;
      return true;
    })());
  }

  /** Coarse global index (~10 km cells): loaded lazily, only when a query's region needs it. */
  private ensureGlobal(): Promise<IndexManifest | null> {
    return (this.globalReady ??= (async () => {
      const m = await getBytes(`${this.base}data/global/manifest.json`);
      if (!m) return null;
      const st = JSON.parse(new TextDecoder().decode(m)) as IndexManifest;
      const stat = await getBytes(`${this.base}data/${st.static.file}`);
      if (!stat) return null;
      this.eng.loadGlobalManifest(new TextDecoder().decode(m));
      this.eng.loadGlobalStatic(stat);
      return st;
    })().then((r) => { if (!r) this.globalReady = undefined; return r; }));
  }

  private async rankGlobal(q: Query, tS: number, tE: number, onProgress?: (p: Progress) => void): Promise<RankResult> {
    onProgress?.({ stage: 'Loading global index', done: 0, total: 1 });
    const gi = await this.ensureGlobal();
    if (!gi) throw new Error('global index (data/global) is not available');
    const months = this.eng.globalMonthsNeeded(tS, tE);
    let done = 0;
    await mapLimit(months, 8, async (mo) => {
      const entry = gi.months.find((x) => x.month === mo);
      if (!entry) return;
      const raw = await getBytes(`${this.base}data/${entry.file}`);
      if (raw) this.eng.addGlobalMonth(mo, raw);
      onProgress?.({ stage: 'Loading global months', done: ++done, total: months.length });
    });
    onProgress?.({ stage: 'Coarse screening (10 km)', done: 0, total: 1 });
    const coarse = this.eng.rankCoarse(q);
    let bd = 0;
    await mapLimit(coarse.bandsNeeded, 8, async (b) => {
      const raw = await getBytes(`${this.base}data/${gi.horizons.bands[b]}`);
      if (raw) this.eng.addGlobalHorizonBand(b, raw);
      onProgress?.({ stage: 'Loading global horizons', done: ++bd, total: coarse.bandsNeeded.length });
    });
    onProgress?.({ stage: 'Refining at 15 min', done: 0, total: 1 });
    const res = this.eng.rankRefine(q, coarse.candidates);
    // report the whole-region screening counts, not the refined shortlist size
    if (coarse.stats?.considered != null) { res.considered = coarse.stats.considered; res.passedFilters = coarse.stats.passedFilters ?? res.passedFilters; }
    res.coarse = true;
    for (const e of res.results) e.coarse = true;
    onProgress?.({ stage: 'Done', done: 1, total: 1 });
    return res;
  }

  async rank(q: Query, onProgress?: (p: Progress) => void): Promise<RankResult> {
    const tS = parseWhen(q.window.start), tE = parseWhen(q.window.end);
    if (q.region.type === 'sites') {
      const [sites, curated] = await Promise.all([this.sites(), this.curated()]);
      const pts: { id: string; lat: number; lon: number; elevDeg: Float32Array }[] = [];
      let i = 0;
      for (const id of q.region.ids) {
        const s = sites.find((x) => x.id === id);
        if (!s) continue;
        const c = curated[id];
        const elevDeg = c ? Float32Array.from(c.horizon) : (await this.horizon(s.lat, s.lon, q.height_m)).elevDeg;
        pts.push({ id, lat: s.lat, lon: s.lon, elevDeg });
        onProgress?.({ stage: 'Loading horizons', done: ++i, total: q.region.ids.length });
      }
      const r = this.eng.rankPoints(q, pts);
      // attach ids by lat/lon match
      r.results.forEach((e) => { e.id = pts.find((p) => Math.abs(p.lat - e.lat) < 1e-6 && Math.abs(p.lon - e.lon) < 1e-6)?.id; });
      return r;
    }
    if (regionIsCoarse(q.region)) return this.rankGlobal(q, tS, tE, onProgress);
    if (!(await this.ensureIndex())) return this.mock.rank(q, onProgress);
    const idx = this.index!;
    const months = this.eng.indexMonthsNeeded(tS, tE);
    let done = 0;
    await mapLimit(months, 8, async (mo) => {
      const entry = idx.months.find((x) => x.month === mo);
      if (!entry) return;
      const raw = await getBytes(`${this.base}data/${entry.file}`);
      if (raw) this.eng.addIndexMonth(mo, raw);
      onProgress?.({ stage: 'Loading index months', done: ++done, total: months.length });
    });
    onProgress?.({ stage: 'Coarse screening', done: 0, total: 1 });
    const tc = performance.now();
    const coarse = this.eng.rankCoarse(q);
    perfLog('worker.rank.coarse', performance.now() - tc, { months: months.length, bands: coarse.bandsNeeded.length });
    let bd = 0;
    await mapLimit(coarse.bandsNeeded, 8, async (b) => {
      const raw = await getBytes(`${this.base}data/${idx.horizons.bands[b]}`);
      if (raw) this.eng.addHorizonBand(b, raw);
      onProgress?.({ stage: 'Loading horizon bands', done: ++bd, total: coarse.bandsNeeded.length });
    });
    onProgress?.({ stage: 'Refining at 15 min', done: 0, total: 1 });
    const tr = performance.now();
    const res = this.eng.rankRefine(q, coarse.candidates);
    perfLog('worker.rank.refine', performance.now() - tr, { candidates: coarse.candidates.length });
    // report the whole-region screening counts, not the refined shortlist size
    if (coarse.stats?.considered != null) { res.considered = coarse.stats.considered; res.passedFilters = coarse.stats.passedFilters ?? res.passedFilters; }
    onProgress?.({ stage: 'Done', done: 1, total: 1 });
    return res;
  }

  async ellipse(a: EllipseArgs): Promise<EllipseResult> {
    const radiusKm = Math.max(a.semiMajorM, a.semiMinorM) / 1000 + 1;
    const keys = new Set([
      ...this.eng.requiredTiles(a.lat, a.lon, undefined, 720),
      ...this.eng.requiredTilesArea(a.lat, a.lon, radiusKm),
    ]);
    await this.ensureTiles([...keys]);
    return this.eng.ellipse(a.lat, a.lon, a.semiMajorM, a.semiMinorM, a.rotDeg, a.n, a.heightM ?? 2, a.tStart, a.tEnd, a.stepS ?? 3600);
  }

  async sampleHeights(w: number, s: number, e: number, n: number, nw: number, nh: number): Promise<Float32Array> {
    const t0 = performance.now();
    await this.ensureTiles(this.eng.requiredTilesRect(w, s, e, n, nw, nh));
    const t1 = performance.now();
    const r = this.eng.sampleHeights(w, s, e, n, nw, nh);
    perfLog('worker.sampleHeights', performance.now() - t0, { fetchMs: Math.round(t1 - t0), computeMs: Math.round(performance.now() - t1) });
    return r;
  }

  async sunEarthAt(lat: number, lon: number, t: number): Promise<SunEarth> {
    return this.eng.sunEarthAt(lat, lon, t);
  }

  /** Fetch (and load) the DEM tiles a patch will read, without computing anything. Returns the tile count. */
  async prefetchPatch(lat: number, lon: number, sizeKm: number, px: number): Promise<number> {
    if (!this.terrain || !this.eng.requiredTilesPatch) return 0;
    const keys = this.eng.requiredTilesPatch(lat, lon, sizeKm, px);
    const t0 = performance.now();
    await this.ensureTiles(keys);
    perfLog('worker.prefetchPatch', performance.now() - t0, { sizeKm, px, tiles: keys.length });
    return keys.length;
  }

  async shadowPatch(lat: number, lon: number, sizeKm: number, px: number, t: number): Promise<ShadowPatch> {
    if (!this.terrain || !this.eng.shadowPatch) return this.mock.shadowPatch(lat, lon, sizeKm, px, t);
    const keys = this.eng.requiredTilesPatch ? this.eng.requiredTilesPatch(lat, lon, sizeKm, px) : this.eng.requiredTilesArea(lat, lon, sizeKm / 2 + 20);
    const t0 = performance.now();
    await this.ensureTiles(keys);
    const t1 = performance.now();
    const r = this.eng.shadowPatch(lat, lon, sizeKm, px, t) as { data?: Uint8Array; px?: number; centerLat?: number; centerLon?: number; sunAz?: number; sunEl?: number } | Uint8Array;
    if (r instanceof Uint8Array) return { lat, lon, sizeKm, px, data: r };
    perfLog('worker.shadowPatch', performance.now() - t0, { sizeKm, px, tiles: keys.length, fetchMs: Math.round(t1 - t0), computeMs: Math.round(performance.now() - t1) });
    const out: ShadowPatch = { lat: r.centerLat ?? lat, lon: r.centerLon ?? lon, sizeKm, px: r.px ?? px, data: r.data as Uint8Array, sunAz: r.sunAz, sunEl: r.sunEl };
    return Comlink.transfer(out, [out.data.buffer]);
  }
}

// ---------------------------------------------------------------------------------------
// Dispatcher: real engine if it initialises, otherwise MockEngine
// ---------------------------------------------------------------------------------------
let impl: EngineApi = new MockEngine();

const api: EngineApi = {
  async init(baseUrl) {
    try {
      const real = new RealEngine();
      const info = await real.tryInit(baseUrl);
      if (info) { impl = real; return info; }
      const notes = [...((real as unknown as { notes: string[] }).notes ?? [])];
      impl = new MockEngine(notes.length ? notes : ['Mock engine: synthetic demo data']);
    } catch (e) {
      console.warn('[engine] falling back to mock', e);
      impl = new MockEngine([`engine error: ${(e as Error).message}`]);
    }
    return impl.init(baseUrl);
  },
  sites: () => impl.sites(),
  missions: () => impl.missions(),
  curated: () => impl.curated(),
  horizon: (la, lo, h) => impl.horizon(la, lo, h),
  visibility: (la, lo, a, b, o) => impl.visibility(la, lo, a, b, o),
  compare: (p, a, b) => impl.compare(p, a, b),
  rank: async (q, cb) => { const t0 = performance.now(); const r = await impl.rank(q, cb); perfLog('worker.rank', performance.now() - t0, { n: r.results.length }); return r; },
  ellipse: (a) => impl.ellipse(a),
  sampleHeights: (...a) => impl.sampleHeights(...a),
  sunEarthAt: (la, lo, t) => impl.sunEarthAt(la, lo, t),
  faults: () => impl.faults(),
  shadowPatch: (la, lo, s, px, t) => impl.shadowPatch(la, lo, s, px, t),
  power: (la, lo, a, b, p, o) => impl.power(la, lo, a, b, p, o),
  traverse: (s, g, t, l, c) => impl.traverse(s, g, t, l, c),
};
/** Lightweight init for the dedicated terrain / shadow workers (same module, smaller footprint). */
(api as unknown as Record<string, unknown>).initLite = async (baseUrl: string, role: 'terrain' | 'shadow') => {
  try {
    const real = new RealEngine();
    const info = await real.tryInit(baseUrl, role);
    if (info) { impl = real; return info; }
  } catch (e) { console.warn(`[engine] ${role} worker falling back to mock`, e); }
  impl = new MockEngine(['Mock engine: synthetic demo data']);
  return impl.init(baseUrl);
};
(api as unknown as Record<string, unknown>).prefetchPatch = (la: number, lo: number, s: number, px: number) =>
  (impl as unknown as { prefetchPatch?: (...a: number[]) => Promise<number> }).prefetchPatch?.(la, lo, s, px) ?? Promise.resolve(0);
if (PERF) (api as unknown as Record<string, unknown>).memInfo = () => (impl as unknown as { memInfo?: () => unknown }).memInfo?.() ?? null;

Comlink.expose(api);
