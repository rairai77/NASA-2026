import * as Comlink from 'comlink';
import { perfLog } from './perf.ts';
import type { EngineApi, InitInfo, Progress, Query, RankResult, ShadowPatch } from './api.ts';

// Three instances of the same worker module (worker.ts), so nothing time-critical queues behind a long job:
//   engine  - everything: ranking, horizons, visibility, comms, power, traverse (full init)
//   terrain - only sampleHeights for the Cesium terrain provider (terrain manifest + tiles, no ephemeris/index/DSN)
//   shadow  - only shadowPatch (ephemeris + terrain manifest + tiles); sweeps block it for seconds, which is fine
// getEngine() returns the engine remote, with sampleHeights re-routed to the terrain worker and shadowPatch to
// the shadow worker, so existing callers keep working unchanged.

type Role = 'terrain' | 'shadow';
interface LiteApi extends EngineApi {
  initLite(baseUrl: string, role: Role): Promise<InitInfo>;
  prefetchPatch(lat: number, lon: number, sizeKm: number, px: number): Promise<number>;
  memInfo?(): Promise<{ wasmMB: number; tiles: number } | null>;
}
const BASE = '/';
/** Dev only: `?legacy` runs everything in the one engine worker, without preview/cache/time rounding (for A/B timing). */
const LEGACY = import.meta.env.DEV && typeof location !== 'undefined' && /[?&]legacy\b/.test(location.search);

function spawn(): Worker { return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); }

let remote: Comlink.Remote<EngineApi> | null = null;
let facade: Comlink.Remote<EngineApi> | null = null;
const lite: Partial<Record<Role, { api: Comlink.Remote<LiteApi>; ready: Promise<unknown> }>> = {};

function liteWorker(role: Role) {
  let l = lite[role];
  if (!l) {
    const api = Comlink.wrap<LiteApi>(spawn());
    const ready = api.initLite(BASE, role).catch((e) => { console.warn(`[engine] ${role} worker init failed`, e); });
    l = lite[role] = { api, ready };
  }
  return l;
}

export function getEngine(): Comlink.Remote<EngineApi> {
  if (!facade) {
    remote = Comlink.wrap<EngineApi>(spawn());
    if (LEGACY) return (facade = remote);
    const terrain = liteWorker('terrain');
    const base = remote;
    const sampleHeights: EngineApi['sampleHeights'] = (...a) => terrain.ready.then(() => terrain.api.sampleHeights(...a));
    const shadowPatch: EngineApi['shadowPatch'] = (...a) => {
      const s = liteWorker('shadow');
      return s.ready.then(() => s.api.shadowPatch(...a));
    };
    facade = new Proxy(base, {
      get(t, p, r) {
        if (p === 'sampleHeights') return sampleHeights;
        if (p === 'shadowPatch') return shadowPatch;
        return Reflect.get(t, p, r);
      },
    });
  }
  return facade;
}

/** Dev: wasm memory and tile counts per worker. */
export async function workerMemory(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const eng = getEngine() as unknown as { memInfo?: () => Promise<unknown> };
  out.engine = await eng.memInfo?.();
  for (const role of ['terrain', 'shadow'] as Role[]) { const l = lite[role]; if (l) out[role] = await (l.api as unknown as { memInfo(): Promise<unknown> }).memInfo(); }
  return out;
}
if (import.meta.env.DEV) (window as unknown as { __workerMemory: typeof workerMemory }).__workerMemory = workerMemory;

export function rankWithProgress(q: Query, cb: (p: Progress) => void): Promise<RankResult> {
  const t0 = performance.now();
  return getEngine().rank(q, Comlink.proxy(cb)).finally(() => perfLog('main.rank', performance.now() - t0));
}

// ---------------------------------------------------------------------------------------------------------
// Shadow patch scheduling: progressive (512 px preview, then the full patch), newest-request-wins per slot,
// and an LRU cache so scrubbing back and forth is instant.
// ---------------------------------------------------------------------------------------------------------
export interface ShadowReq { slot: string; lat: number; lon: number; sizeKm: number; px: number; t: number }
export interface ShadowResult { patch: ShadowPatch; /** false for the low-res preview */ final: boolean; cached: boolean }

/** Requested times are rounded to this many seconds (the Sun moves ~0.04 deg in 5 min). */
const T_QUANT_S = 300;
const PREVIEW_PX = 512;
const CACHE_BYTES = 96e6;

const patchKey = (r: { lat: number; lon: number; sizeKm: number }, px: number, tq: number) =>
  `${r.lat.toFixed(4)},${r.lon.toFixed(4)},${r.sizeKm},${px},${tq}`;
const cache = new Map<string, ShadowPatch>();
function cacheGet(k: string): ShadowPatch | undefined {
  const v = cache.get(k);
  if (v) { cache.delete(k); cache.set(k, v); }
  return v;
}
function cachePut(k: string, v: ShadowPatch) {
  cache.delete(k); cache.set(k, v);
  let bytes = 0;
  for (const p of cache.values()) bytes += p.data.byteLength;
  for (const key of cache.keys()) {
    if (bytes <= CACHE_BYTES || cache.size <= 1) break;
    bytes -= cache.get(key)!.data.byteLength;
    cache.delete(key);
  }
}
export const quantTime = (t: number) => Math.round(t / T_QUANT_S) * T_QUANT_S;
export function isShadowCached(r: ShadowReq): boolean { return !LEGACY && cache.has(patchKey(r, r.px, quantTime(r.t))); }

interface Job { req: ShadowReq; seq: number; cb: (r: ShadowResult) => void; done: () => void }
const pending = new Map<string, Job>();
const latest = new Map<string, number>();
let seqCounter = 0;
let running = false;
/** Per slot: location of the last full patch computed. The worker keeps that grid warm, so a time-only change
 *  (scrubbing) goes straight to the full sweep; a preview is only worth it when the grid must be rebuilt. */
const warmFull = new Map<string, string>();

/** Ask for a patch; `cb` gets the preview (if any) and then the final patch. A newer request for the same slot
 *  supersedes this one (its callbacks stop; a computation already running finishes into the cache). */
export function requestShadow(req: ShadowReq, cb: (r: ShadowResult) => void): Promise<void> {
  const seq = ++seqCounter;
  latest.set(req.slot, seq);
  return new Promise((resolve) => {
    pending.get(req.slot)?.done();
    pending.set(req.slot, { req, seq, cb, done: resolve });
    void pump();
  });
}
export function cancelShadow(slot: string) {
  latest.set(slot, ++seqCounter);
  const p = pending.get(slot);
  if (p) { pending.delete(slot); p.done(); }
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (pending.size) {
      let job: Job | undefined;
      for (const j of pending.values()) if (!job || j.seq > job.seq) job = j; // newest first
      pending.delete(job!.req.slot);
      try { await runJob(job!); } catch (e) { console.warn('[shadows]', e); } finally { job!.done(); }
    }
  } finally { running = false; }
}

async function runJob(job: Job) {
  const { req } = job;
  const stale = () => latest.get(req.slot) !== job.seq;
  const tq = LEGACY ? req.t : quantTime(req.t);
  if (LEGACY) {
    const p = await getEngine().shadowPatch(req.lat, req.lon, req.sizeKm, req.px, tq);
    if (!stale()) job.cb({ patch: p, final: true, cached: false });
    return;
  }
  const fullKey = patchKey(req, req.px, tq);
  const hit = cacheGet(fullKey);
  if (hit) { job.cb({ patch: hit, final: true, cached: true }); return; }
  const eng = getEngine();
  const t0 = performance.now();
  const loc = `${req.lat.toFixed(4)},${req.lon.toFixed(4)},${req.sizeKm},${req.px}`;
  if (req.px > 1024 && warmFull.get(req.slot) !== loc) {
    // Prefetch the full patch's DEM tiles in the shadow worker while the preview computes.
    void liteWorker('shadow').ready.then(() => lite.shadow!.api.prefetchPatch(req.lat, req.lon, req.sizeKm, req.px)).catch(() => {});
    const lk = patchKey(req, PREVIEW_PX, tq);
    let low = cacheGet(lk);
    if (!low) { low = await eng.shadowPatch(req.lat, req.lon, req.sizeKm, PREVIEW_PX, tq); cachePut(lk, low); }
    if (stale()) return;
    perfLog('main.shadowPreview', performance.now() - t0, { sizeKm: req.sizeKm, px: PREVIEW_PX });
    job.cb({ patch: low, final: false, cached: false });
  }
  const full = await eng.shadowPatch(req.lat, req.lon, req.sizeKm, req.px, tq);
  cachePut(fullKey, full);
  warmFull.set(req.slot, loc);
  if (stale()) return;
  job.cb({ patch: full, final: true, cached: false });
}
