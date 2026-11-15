// Query helpers: defaults, merge of partial parse output, chip descriptions.
import type { Panel, Query } from '../engine/api.ts';
import { METRIC_BY_NAME, fmtMetric, metricLabel } from './metrics.ts';

export function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }
export function addDays(day: string, n: number): string {
  return isoDay(new Date(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) + n * 86400000));
}

export function defaultQuery(today = isoDay(new Date())): Query {
  return {
    window: { start: today, end: addDays(today, 30) },
    region: { type: 'polar', min_lat: -90, max_lat: -85 },
    height_m: 2,
    filters: [],
    objectives: [{ metric: 'sun_hours', dir: 'max' }, { metric: 'both_hours', dir: 'max' }],
    mode: 'lexicographic',
    weights: null,
    k: 5,
    min_separation_km: 10,
  };
}

/** Latitude below which the 20 m polar index applies (manifest grid.max_lat). */
export const POLAR_INDEX_MAX_LAT = -85;
const KM_PER_DEG = 111.195;

/** Mirrors the engine's index choice: false = polar 20 m index, true = coarse global 10 km index. */
export function regionIsCoarse(r: Query['region']): boolean {
  switch (r.type) {
    case 'polar': return r.max_lat > POLAR_INDEX_MAX_LAT + 1e-9;
    case 'circle': return !(r.lat + r.radius_km / KM_PER_DEG <= POLAR_INDEX_MAX_LAT && r.lat <= POLAR_INDEX_MAX_LAT);
    case 'bbox': return r.north > POLAR_INDEX_MAX_LAT + 1e-9;
    case 'global': return true;
    case 'sites': return false;
  }
}

export const DEFAULT_PANEL: Panel = {
  kind: 'vertical_tracking', areaM2: 3, efficiency: 0.3, loadW: 150, depthOfDischarge: 0.8, batteryWh: 2000,
};

function cleanPanel(p: unknown): Panel | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const num = (...ks: string[]) => { for (const k of ks) if (typeof o[k] === 'number' && Number.isFinite(o[k] as number)) return o[k] as number; return undefined; };
  const kind = o.kind;
  if (kind !== 'vertical_fixed' && kind !== 'vertical_tracking' && kind !== 'horizontal') return null;
  const out: Panel = {
    kind,
    areaM2: num('areaM2', 'area_m2') ?? DEFAULT_PANEL.areaM2,
    efficiency: num('efficiency') ?? DEFAULT_PANEL.efficiency,
    loadW: num('loadW', 'load_w') ?? DEFAULT_PANEL.loadW,
    depthOfDischarge: num('depthOfDischarge', 'depth_of_discharge') ?? DEFAULT_PANEL.depthOfDischarge,
  };
  const az = num('azimuthDeg', 'azimuth_deg'); if (az !== undefined) out.azimuthDeg = az;
  const b = num('batteryWh', 'battery_wh'); if (b !== undefined) out.batteryWh = b;
  if (!(out.areaM2 > 0) || !(out.efficiency > 0 && out.efficiency <= 1) || !(out.depthOfDischarge > 0 && out.depthOfDischarge <= 1)) return null;
  return out;
}

function cleanRegion(r: unknown, fallback: Query['region']): Query['region'] {
  if (!r || typeof r !== 'object') return fallback;
  const o = r as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k] as number) ? (o[k] as number) : null);
  switch (o.type) {
    case 'global': return { type: 'global' };
    case 'bbox': {
      const [w, s, e, nn] = [n('west'), n('south'), n('east'), n('north')];
      return w !== null && s !== null && e !== null && nn !== null ? { type: 'bbox', west: w, south: s, east: e, north: nn } : fallback;
    }
    case 'polar': return n('min_lat') !== null && n('max_lat') !== null ? (r as Query['region']) : fallback;
    case 'circle': return n('lat') !== null && n('lon') !== null && n('radius_km') !== null ? (r as Query['region']) : fallback;
    case 'sites': return Array.isArray(o.ids) ? (r as Query['region']) : fallback;
    default: return fallback;
  }
}

/** Merge a (possibly partial / sloppy) parse result onto defaults. Invalid pieces are dropped. */
export function mergeQuery(base: Query, partial: unknown): Query {
  const p = (partial ?? {}) as Partial<Query>;
  const q: Query = JSON.parse(JSON.stringify(base));
  const day = /^\d{4}-\d{2}-\d{2}/;
  if (p.window && day.test(p.window.start ?? '') && day.test(p.window.end ?? '')) q.window = { start: p.window.start, end: p.window.end };
  if (p.region && typeof p.region === 'object' && 'type' in p.region) q.region = cleanRegion(p.region, q.region);
  if (typeof p.relay === 'boolean') q.relay = p.relay;
  if (p.power !== undefined) { const pw = cleanPanel(p.power); if (pw) q.power = pw; else if (p.power === null) q.power = null; }
  if (typeof p.height_m === 'number') q.height_m = p.height_m;
  if (Array.isArray(p.filters)) q.filters = p.filters.filter((f) => METRIC_BY_NAME[f?.metric] && ['<', '<=', '>', '>='].includes(f.op) && Number.isFinite(f.value));
  if (Array.isArray(p.objectives) && p.objectives.length) q.objectives = p.objectives.filter((o) => METRIC_BY_NAME[o?.metric] && (o.dir === 'max' || o.dir === 'min'));
  if (p.mode === 'weighted' || p.mode === 'lexicographic') q.mode = p.mode;
  if (Array.isArray(p.weights)) q.weights = p.weights;
  if (typeof p.k === 'number') q.k = Math.max(1, Math.min(50, Math.round(p.k)));
  if (typeof p.min_separation_km === 'number') q.min_separation_km = p.min_separation_km;
  if (q.mode === 'weighted' && (!q.weights || q.weights.length !== q.objectives.length)) q.weights = q.objectives.map(() => 1);
  return q;
}

export interface ChipDesc { key: string; kind: 'window' | 'region' | 'height' | 'filter' | 'objective' | 'k' | 'sep' | 'relay'; text: string }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** One human date format for the strip and editors: "Nov 15, 2026". */
export function fmtDay(d: string): string {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
  return y && m && dd ? `${MON[m - 1]} ${dd}, ${y}` : d.slice(0, 10);
}
/** The query window is [start, end) internally; people read it as an inclusive range ("Nov 15 – Dec 14, 2026"). */
export function fmtWindowIncl(a: string, b: string): string {
  const last = addDays(b, -1);
  const [ya, ma, da] = a.slice(0, 10).split('-').map(Number), [yb, mb, db] = last.split('-').map(Number);
  if (!ya || !yb) return `${a.slice(0, 10)} to ${last}`;
  return ya === yb ? `${MON[ma - 1]} ${da} – ${MON[mb - 1]} ${db}, ${yb}` : `${fmtDay(a)} – ${fmtDay(last)}`;
}

/** Objective chip text with its direction, e.g. "Lowest slope", "Most Sun hours". */
export function objectiveText(metric: string, dir: 'max' | 'min', educator = false): string {
  const l = metricLabel(metric, educator);
  const m = METRIC_BY_NAME[metric];
  if (m?.unit === 'h' && m.kind === 'window' && /hours$/i.test(l)) return `${dir === 'max' ? 'Most' : 'Fewest'} ${l}`;
  if (/^longest /i.test(l)) return `${dir === 'max' ? 'Longest' : 'Shortest'} ${l.replace(/^longest /i, '')}`;
  const lc = /^(Sun|Earth|PSR|DSN)/.test(l) ? l : l.charAt(0).toLowerCase() + l.slice(1);
  return `${dir === 'max' ? 'Highest' : 'Lowest'} ${lc}`;
}

/** Tiny keyword prefill used when the language parser is unavailable: month + year, "N days", "south pole". */
export function prefillFromText(text: string, base: Query): Query {
  const q: Query = JSON.parse(JSON.stringify(base));
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const mm = text.toLowerCase().match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?,?\s+(?:of\s+)?(20\d\d)\b/);
  if (mm) {
    const mi = full.findIndex((f) => f.startsWith(mm[1].slice(0, 3)));
    const y = Number(mm[2]);
    if (mi >= 0) {
      const start = `${y}-${String(mi + 1).padStart(2, '0')}-01`;
      const end = mi === 11 ? `${y + 1}-01-01` : `${y}-${String(mi + 2).padStart(2, '0')}-01`;
      q.window = { start, end };
    }
  }
  const nd = text.match(/\b(\d{1,3})[-\s]*(?:continuous\s+)?days?\b/i);
  if (nd && Number(nd[1]) > 0) {
    q.filters = [...q.filters.filter((f) => f.metric !== 'longest_both_h'), { metric: 'longest_both_h', op: '>=', value: Number(nd[1]) * 24 }];
  }
  if (/south(ern)?\s+pole|south polar/i.test(text)) q.region = { type: 'polar', min_lat: -90, max_lat: -85 };
  return q;
}

export function describeRegion(r: Query['region'], siteName?: (id: string) => string | undefined): string {
  switch (r.type) {
    case 'polar': {
      const lo = Math.min(Math.abs(r.min_lat), Math.abs(r.max_lat)), hi = Math.max(Math.abs(r.min_lat), Math.abs(r.max_lat));
      const hemi = r.max_lat <= 0 ? 'S' : r.min_lat >= 0 ? 'N' : '';
      if (hemi && hi >= 89.999) return `${hemi === 'S' ? 'South' : 'North'} polar cap ${lo}–90° ${hemi}`;
      return hemi ? `${lo}–${hi}° ${hemi}` : `lat ${r.min_lat}° to ${r.max_lat}°`;
    }
    case 'circle': return `${r.radius_km} km around ${r.lat.toFixed(2)}°, ${r.lon.toFixed(2)}°`;
    case 'sites': return r.ids.length === 1 && siteName?.(r.ids[0]) ? siteName(r.ids[0])! : `${r.ids.length} curated site${r.ids.length === 1 ? '' : 's'}`;
    case 'bbox': return `box ${r.south}° to ${r.north}° lat, ${r.west}° to ${r.east}° lon`;
    case 'global': return 'whole Moon';
  }
}

/** The chip view of a query; every chip maps 1:1 to a field of the Query object. */
export function describeQuery(q: Query, educator = false): ChipDesc[] {
  const out: ChipDesc[] = [
    { key: 'window', kind: 'window', text: `${q.window.start.slice(0, 10)} → ${q.window.end.slice(0, 10)}` },
    { key: 'region', kind: 'region', text: describeRegion(q.region) },
    { key: 'height', kind: 'height', text: `height ${q.height_m} m` },
  ];
  q.filters.forEach((f, i) => out.push({ key: `f${i}`, kind: 'filter', text: `${metricLabel(f.metric, educator)} ${f.op} ${fmtMetric(f.metric, f.value).replace(/\s*\(.*\)/, '')}` }));
  q.objectives.forEach((o, i) => out.push({ key: `o${i}`, kind: 'objective', text: `${i + 1}. ${o.dir === 'max' ? 'max' : 'min'} ${metricLabel(o.metric, educator)}` }));
  if (q.relay) out.push({ key: 'relay', kind: 'relay', text: 'relay orbiter assumed' });
  out.push({ key: 'k', kind: 'k', text: `top ${q.k}` });
  out.push({ key: 'sep', kind: 'sep', text: `≥ ${q.min_separation_km} km apart` });
  return out;
}
