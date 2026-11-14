import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { CuratedSite, HorizonResult, InitInfo, Mission, Progress, Query, RankResult, Site, VisResult } from './engine/api.ts';
import { getEngine, rankWithProgress } from './engine/client.ts';
import { DAY, clamp, parseWhen, toDay } from './lib/time.ts';
import { decodeState, type ShareState, type TargetStub } from './lib/share.ts';
import { addDays, defaultQuery, mergeQuery } from './query/query.ts';

export interface Target {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: 'site' | 'result' | 'point';
  group?: string;
  rank?: number;
  representative?: boolean;
  metrics?: Record<string, number | undefined>;
}
export interface TargetData { horizon?: HorizonResult; vis?: VisResult; key?: string; loading?: boolean; error?: string }

export type LeftTab = 'results' | 'sites' | 'layers' | 'replay' | 'diff';
export const MAX_COMPARE = 4;

export interface Layers { sites: boolean; results: boolean; faults: boolean; keepout: boolean; keepoutKm: number; shadows: boolean }

export interface LayerDef {
  id: string; title: string; units: string; source: string; citation?: string; maxLevel: number;
  rectangle: [number, number, number, number]; path: string;
  legend: { min: number; max: number; stops: [number, string][] };
  opacity: number; tileLatLimits?: Record<string, number>;
}
export interface LayerState { on: boolean; opacity: number }

export interface Marker { t: number; label: string; kind: 'landing' | 'pred' | 'end' }
export interface ReplayInfo {
  id: string; name: string; landed: number; predSunset: number | null; reportedEnd: number | null; deltaH: number | null;
  endKind: string; endReason: string; source: 'precomputed' | 'live';
}
export interface Scenario {
  label: 'A' | 'B'; query: Query; target: Target; vis: VisResult; metrics: Record<string, number | undefined>; note: string;
}

interface State {
  info: InitInfo | null;
  sites: Site[];
  missions: Mission[];
  curated: Record<string, CuratedSite>;
  targets: Record<string, Target>;

  query: Query;
  unparsed: string[];
  warnings: string[];
  parsing: boolean;
  results: RankResult | null;
  ranking: boolean;
  progress: Progress | null;

  selected: string | null;
  compare: string[];
  data: Record<string, TargetData>;

  cursor: number;
  playing: boolean;
  speed: number; // seconds of sim time per real second
  view: [number, number];

  layers: Layers;
  educator: boolean;
  leftTab: LeftTab;
  fpOpen: boolean;
  validationOpen: boolean;
  builderOpen: boolean;
  toast: { msg: string; id: number } | null;
  ellipseDraw: { lat: number; lon: number; a: number; b: number; rot: number } | null;
  fly: { id: string | null; global?: boolean; nonce: number } | null;
  layerDefs: LayerDef[];
  layerState: Record<string, LayerState>;
  exaggeration: number;
  markers: Marker[];
  replay: ReplayInfo | null;
  playUntil: number | null;
  scenA: Scenario | null;
  scenB: Scenario | null;
  pendingSlip: boolean;
  tourStep: number | null;
  initialCam: ShareState['cam'];
}

const today = toDay(Date.now() / 1000);

function window_(q: Query): [number, number] {
  return [parseWhen(q.window.start), parseWhen(q.window.end)];
}

const restored = decodeState(typeof location !== 'undefined' ? location.hash : '');
const q0 = restored?.q ? mergeQuery(defaultQuery(today), restored.q) : defaultQuery(today);
const [w0, w1] = window_(q0);

export const useStore = create<State>(() => ({
  info: null, sites: [], missions: [], curated: {}, targets: {},
  query: q0, unparsed: [], warnings: [], parsing: false, results: null, ranking: false, progress: null,
  selected: null, compare: [], data: {},
  cursor: clamp(restored?.t ?? w0 + (w1 - w0) * 0.1, w0, w1), playing: false, speed: 6 * 3600, view: [w0, w1],
  layers: { sites: true, results: true, faults: false, keepout: false, keepoutKm: 5, shadows: false },
  layerDefs: [], layerState: {}, exaggeration: 1, markers: [], replay: null, playUntil: null, scenA: null, scenB: null, pendingSlip: false, tourStep: null,
  educator: restored?.ed ?? false, leftTab: (restored?.tab as LeftTab) ?? 'results',
  fpOpen: false, validationOpen: false, builderOpen: false, toast: null, ellipseDraw: null, fly: null,
  initialCam: restored?.cam ?? null,
}));

const set = useStore.setState;
const get = useStore.getState;

let toastId = 0;
export function toast(msg: string) {
  const id = ++toastId;
  set({ toast: { msg, id } });
  setTimeout(() => { if (get().toast?.id === id) set({ toast: null }); }, 6000);
}

export function windowOf(q = get().query): [number, number] { return window_(q); }

/** Step used for the time series of the active window (15 min, coarser for multi-year windows). */
export function seriesStep(q = get().query): number {
  const [a, b] = window_(q);
  return Math.max(900, Math.ceil((b - a) / 45000 / 900) * 900);
}

// ---------------------------------------------------------------------------------------
export function registerTargets(ts: Target[]) {
  set((s) => {
    const next = { ...s.targets };
    for (const t of ts) next[t.id] = { ...next[t.id], ...t };
    return { targets: next };
  });
}

export function stubOf(t: Target): TargetStub { return { id: t.id, lat: t.lat, lon: t.lon, name: t.name, kind: t.kind }; }

export function resultId(lat: number, lon: number) { return `r:${lat.toFixed(4)},${lon.toFixed(4)}`; }

export function setQuery(q: Query, rank = true) {
  const [a, b] = window_(q);
  set((s) => ({ query: q, view: [a, b], cursor: clamp(s.cursor, a, b) }));
  if (rank) scheduleRank();
}
export function patchQuery(p: Partial<Query>, rank = true) {
  if (get().markers.length) set({ markers: [], replay: null, playUntil: null });
  setQuery({ ...get().query, ...p }, rank);
}

let rankTimer: ReturnType<typeof setTimeout> | undefined;
export function scheduleRank(delay = 350) {
  clearTimeout(rankTimer);
  rankTimer = setTimeout(runRank, delay);
}

let rankSeq = 0;
let keepRestoredSelection = false;
export function keepSelection() { keepRestoredSelection = true; }
export async function runRank() {
  const seq = ++rankSeq;
  const q = get().query;
  set({ ranking: true, progress: { stage: 'Starting', done: 0, total: 1 } });
  try {
    const res = await rankWithProgress(q, (p) => { if (seq === rankSeq) set({ progress: p }); });
    if (seq !== rankSeq) return;
    const ts: Target[] = res.results.map((r) => {
      const id = r.id ?? resultId(r.lat, r.lon);
      const site = r.id ? get().targets[r.id] : undefined;
      return {
        id, kind: site ? 'site' : 'result', rank: r.rank, lat: r.lat, lon: r.lon, metrics: r.metrics,
        name: site?.name ?? `${r.lat.toFixed(2)}°, ${r.lon.toFixed(2)}°`,
        group: site?.group, representative: site?.representative,
      };
    });
    registerTargets(ts);
    set({ results: res, ranking: false, progress: null });
    const s = get();
    if (ts.length) {
      if (q.region.type === 'sites' && ts.length <= MAX_COMPARE) {
        set({ compare: ts.map((t) => t.id), selected: ts[0].id });
      } else if (keepRestoredSelection) {
        keepRestoredSelection = false;
      } else if (!s.selected || s.selected.startsWith('r:')) {
        set({ selected: ts[0].id });
      }
    }
  } catch (e) {
    if (seq !== rankSeq) return;
    console.error(e);
    set({ ranking: false, progress: null });
    toast(`Ranking failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------------------
export async function parseText(text: string) {
  set({ parsing: true });
  try {
    const res = await fetch('/api/parse', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 500), today }),
    });
    const ct = res.headers.get('content-type') ?? '';
    if (!res.ok || !ct.includes('json')) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { query?: unknown; unparsed?: string[]; warnings?: string[] };
    if (!j || typeof j.query !== 'object') throw new Error('bad response');
    const q = mergeQuery(defaultQuery(today), j.query);
    set({ unparsed: j.unparsed ?? [], warnings: j.warnings ?? [], parsing: false });
    if (j.warnings?.length) toast(`Parser warnings: ${j.warnings.join('; ')}`);
    setQuery(q, false);
    runRank();
  } catch (e) {
    console.warn('[parse] failed', e);
    set({ parsing: false, builderOpen: true });
    toast('Natural-language parsing is unavailable here. Use the query builder instead.');
  }
}

// ---------------------------------------------------------------------------------------
// Selection and per-target data (horizon + visibility over the active window)
export function select(id: string | null) { set({ selected: id }); }
export function toggleCompare(id: string) {
  const c = get().compare;
  if (c.includes(id)) set({ compare: c.filter((x) => x !== id) });
  else if (c.length >= MAX_COMPARE) toast(`Compare holds at most ${MAX_COMPARE} sites`);
  else set({ compare: [...c, id] });
}

export function activeIds(s = get()): string[] {
  const ids = [...s.compare];
  if (s.selected && !ids.includes(s.selected)) ids.unshift(s.selected);
  return ids;
}

export const useActiveIds = () => useStore(useShallow((s) => activeIds(s)));

const inflight = new Map<string, string>();
export async function refreshData() {
  const s = get();
  const [t0, t1] = window_(s.query);
  const step = seriesStep(s.query);
  const eng = getEngine();
  for (const id of activeIds(s)) {
    const t = s.targets[id];
    if (!t) continue;
    const key = `${t0}|${t1}|${step}|${s.query.height_m}`;
    if (s.data[id]?.key === key || inflight.get(id) === key) continue;
    inflight.set(id, key);
    set((st) => ({ data: { ...st.data, [id]: { ...st.data[id], loading: true } } }));
    try {
      let horizon = s.data[id]?.horizon;
      if (!horizon) {
        const c = s.curated[id];
        if (c && c.horizon.length) {
          horizon = { nAz: c.horizon.length, elevDeg: Float32Array.from(c.horizon), resolutionM: c.resolution_m, maxDistKm: 300, siteElevM: c.site_elev_m, missingSamples: 0 };
        } else horizon = await eng.horizon(t.lat, t.lon, s.query.height_m);
        set((st) => ({ data: { ...st.data, [id]: { ...st.data[id], horizon } } }));
      }
      const vis = await eng.visibility(t.lat, t.lon, t0, t1, { stepS: step, heightM: s.query.height_m, elevDeg: horizon.elevDeg });
      if (inflight.get(id) === key) set((st) => ({ data: { ...st.data, [id]: { horizon, vis, key, loading: false } } }));
    } catch (e) {
      console.error(e);
      set((st) => ({ data: { ...st.data, [id]: { ...st.data[id], loading: false, error: String(e) } } }));
    } finally {
      if (inflight.get(id) === key) inflight.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------------------
export function setCursor(t: number) {
  const [a, b] = window_(get().query);
  set({ cursor: clamp(t, a, b) });
}
export function flyTo(id: string | null, global = false) {
  set({ fly: { id, global, nonce: (get().fly?.nonce ?? 0) + 1 } });
}

// ---------------------------------------------------------------------------------------
export async function bootstrap() {
  const eng = getEngine();
  const info = await eng.init('/');
  const [sites, missions, curated] = await Promise.all([eng.sites(), eng.missions(), eng.curated().catch(() => ({}))]);
  loadLayerDefs();
  const ts: Target[] = sites.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, kind: 'site', group: s.group, representative: s.representative }));
  registerTargets(ts);
  set({ info, sites, missions, curated });
  // restore shared selection
  if (restored) {
    const stubs = [restored.sel, ...(restored.cmp ?? [])].filter((x): x is TargetStub => !!x);
    registerTargets(stubs.filter((x) => !get().targets[x.id]).map((x) => ({ id: x.id, name: x.name, lat: x.lat, lon: x.lon, kind: x.kind as Target['kind'] })));
    keepRestoredSelection = !!restored.sel;
    set({ selected: restored.sel?.id ?? null, compare: (restored.cmp ?? []).map((x) => x.id) });
  }
  runRank();
}

if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore;


// ---------------------------------------------------------------------------------------
// Context layers (layers/manifest.json)
async function loadLayerDefs() {
  try {
    const r = await fetch('/data/layers/manifest.json');
    if (!r.ok || (r.headers.get('content-type') ?? '').includes('html')) return;
    const defs = (await r.json()) as LayerDef[];
    const state: Record<string, LayerState> = {};
    for (const d of defs) state[d.id] = { on: false, opacity: d.opacity ?? 1 };
    set({ layerDefs: defs, layerState: state });
  } catch { /* no layers yet */ }
}
export function setLayerState(id: string, p: Partial<LayerState>) {
  set((s) => ({ layerState: { ...s.layerState, [id]: { ...s.layerState[id], ...p } } }));
}

// ---------------------------------------------------------------------------------------
// Mission replay
interface MissionPred { predicted_sunset_utc?: string | null; sunset_minus_end_h?: number | null }
let predP: Promise<Record<string, MissionPred> | null> | undefined;
function loadPred() {
  return (predP ??= fetch('/data/missions_pred.json').then(async (r) => (r.ok && !(r.headers.get('content-type') ?? '').includes('html') ? ((await r.json()) as Record<string, MissionPred>) : null)).catch(() => null));
}
const isoSec = (t: number) => new Date(t * 1000).toISOString().slice(0, 19) + 'Z';

export async function startReplay(mid: string) {
  const m = get().missions.find((x) => x.id === mid);
  if (!m) return;
  const landed = parseWhen(m.landed_utc);
  const end = m.end_utc ? parseWhen(m.end_utc) : null;
  const kind = (m as unknown as { end_kind?: string }).end_kind ?? '';
  let predSunset: number | null = null;
  let source: ReplayInfo['source'] = 'precomputed';
  const pred = (await loadPred())?.[mid];
  if (pred?.predicted_sunset_utc) predSunset = parseWhen(pred.predicted_sunset_utc);
  else {
    source = 'live';
    try {
      const v = await getEngine().visibility(m.lat, m.lon, landed - 2 * DAY, landed + 20 * DAY, { stepS: 900 });
      predSunset = v.events.find((e) => e.kind === 'sunset' && e.t > landed)?.t ?? null;
    } catch (e) { console.warn(e); }
  }
  const tid = `m:${mid}`;
  registerTargets([{ id: tid, name: m.name, lat: m.lat, lon: m.lon, kind: 'point', group: 'Mission replay' }]);
  const q: Query = { ...get().query, window: { start: isoSec(landed - DAY), end: isoSec(landed + 16 * DAY) } };
  const markers: Marker[] = [{ t: landed, label: 'Landing', kind: 'landing' }];
  if (predSunset) markers.push({ t: predSunset, label: 'Predicted sunset', kind: 'pred' });
  if (end) markers.push({ t: end, label: 'Reported end', kind: 'end' });
  const [a, b] = window_(q);
  set({
    query: q, view: [a, b], selected: tid, compare: [], markers, leftTab: 'replay',
    replay: { id: mid, name: m.name, landed, predSunset, reportedEnd: end, deltaH: predSunset && end ? (predSunset - end) / 3600 : null, endKind: kind, endReason: m.end_reason, source },
    cursor: landed, playUntil: predSunset, speed: DAY, playing: true,
  });
  flyTo(tid);
}

// ---------------------------------------------------------------------------------------
// Scenarios A/B and launch slip
export function dataKey(q = get().query) {
  const [t0, t1] = window_(q);
  return `${t0}|${t1}|${seriesStep(q)}|${q.height_m}`;
}

export function saveScenario(which: 'A' | 'B'): boolean {
  const s = get();
  const t = s.selected ? s.targets[s.selected] : undefined;
  const d = s.selected ? s.data[s.selected] : undefined;
  if (!t || !d?.vis || d.key !== dataKey()) { toast('Select a site and wait for its timeline to finish computing.'); return false; }
  const scen: Scenario = {
    label: which, query: JSON.parse(JSON.stringify(s.query)), target: { ...t }, vis: d.vis,
    metrics: { ...(t.metrics ?? {}), ...(d.vis.metrics as Record<string, number | undefined>) }, note: '',
  };
  set(which === 'A' ? { scenA: scen } : { scenB: scen });
  return true;
}

export function slipLaunch(weeks: number) {
  if (!saveScenario('A')) return;
  const q = get().query;
  const shift = Math.round(weeks * 7);
  keepSelection();
  setQuery({ ...q, window: { start: addDays(q.window.start, shift), end: addDays(q.window.end, shift) } }, true);
  set({ pendingSlip: true, leftTab: 'diff' });
}

export function applyNasaScreening() {
  const q = get().query;
  const [a, b] = window_(q);
  const winH = (b - a) / 3600;
  const drop = new Set(['slope_deg', 'earth_hours', 'sun_frac']);
  const filters = [
    ...q.filters.filter((f) => !drop.has(f.metric)),
    { metric: 'slope_deg', op: '<=' as const, value: 10 },
    { metric: 'earth_hours', op: '>=' as const, value: Math.round(0.25 * winH) },
    { metric: 'sun_frac', op: '>=' as const, value: 0.05 },
  ];
  patchQuery({ filters, region: { type: 'polar', min_lat: -90, max_lat: -84 } });
  toast('NASA Artemis screening (approx.): slope ≤ 10°, Earth ≥ 25% and Sun ≥ 5% of the window, within 6° of the pole.');
}
