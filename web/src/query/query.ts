// Query helpers: defaults, merge of partial parse output, chip descriptions.
import type { Query } from '../engine/api.ts';
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
    objectives: [{ metric: 'sun_hours', dir: 'max' }],
    mode: 'lexicographic',
    weights: null,
    k: 5,
    min_separation_km: 2,
  };
}

/** Merge a (possibly partial / sloppy) parse result onto defaults. Invalid pieces are dropped. */
export function mergeQuery(base: Query, partial: unknown): Query {
  const p = (partial ?? {}) as Partial<Query>;
  const q: Query = JSON.parse(JSON.stringify(base));
  const day = /^\d{4}-\d{2}-\d{2}/;
  if (p.window && day.test(p.window.start ?? '') && day.test(p.window.end ?? '')) q.window = { start: p.window.start, end: p.window.end };
  if (p.region && typeof p.region === 'object' && 'type' in p.region) q.region = p.region as Query['region'];
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

export interface ChipDesc { key: string; kind: 'window' | 'region' | 'height' | 'filter' | 'objective' | 'k' | 'sep'; text: string }

export function describeRegion(r: Query['region']): string {
  switch (r.type) {
    case 'polar': return `lat ${r.min_lat}° to ${r.max_lat}°`;
    case 'circle': return `${r.radius_km} km around ${r.lat.toFixed(2)}°, ${r.lon.toFixed(2)}°`;
    case 'sites': return `${r.ids.length} curated site${r.ids.length === 1 ? '' : 's'}`;
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
  out.push({ key: 'k', kind: 'k', text: `top ${q.k}` });
  out.push({ key: 'sep', kind: 'sep', text: `≥ ${q.min_separation_km} km apart` });
  return out;
}
