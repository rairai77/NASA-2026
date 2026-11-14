import { useMemo, useState } from 'react';
import type { Filter, Objective, Query } from '../engine/api.ts';
import { RANKABLE, METRIC_BY_NAME, metricLabel } from '../query/metrics.ts';
import { addDays } from '../query/query.ts';
import { useStore } from '../store.ts';
import { NumInput } from './ui.tsx';

export function WindowEditor({ q, onChange }: { q: Query; onChange: (w: Query['window']) => void }) {
  const s = q.window.start.slice(0, 10), e = q.window.end.slice(0, 10);
  const shift = (d: number) => onChange({ start: addDays(s, d), end: addDays(e, d) });
  return (
    <div className="ed">
      <label>Start (UTC)<input type="date" value={s} onChange={(ev) => ev.target.value && onChange({ start: ev.target.value, end: e <= ev.target.value ? addDays(ev.target.value, 1) : e })} /></label>
      <label>End (exclusive)<input type="date" value={e} min={addDays(s, 1)} onChange={(ev) => ev.target.value && onChange({ start: s, end: ev.target.value })} /></label>
      <div className="row">
        <button className="btn sm" onClick={() => shift(-30)}>{'−'}30 d</button>
        <button className="btn sm" onClick={() => shift(30)}>+30 d</button>
        <button className="btn sm" onClick={() => shift(-91)}>{'−'}3 mo</button>
        <button className="btn sm" onClick={() => shift(91)}>+3 mo</button>
      </div>
      <div className="row">
        {[7, 30, 90, 365].map((d) => <button key={d} className="btn sm ghost" onClick={() => onChange({ start: s, end: addDays(s, d) })}>{d} d long</button>)}
      </div>
    </div>
  );
}

export function RegionEditor({ q, onChange }: { q: Query; onChange: (r: Query['region']) => void }) {
  const sites = useStore((st) => st.sites);
  const r = q.region;
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => sites.filter((x) => x.name.toLowerCase().includes(filter.toLowerCase())), [sites, filter]);
  return (
    <div className="ed">
      <label>Region type
        <select value={r.type} onChange={(ev) => {
          const t = ev.target.value;
          if (t === 'polar') onChange({ type: 'polar', min_lat: -90, max_lat: -85 });
          else if (t === 'circle') onChange({ type: 'circle', lat: -85, lon: 0, radius_km: 100 });
          else onChange({ type: 'sites', ids: sites.slice(0, 4).map((x) => x.id) });
        }}>
          <option value="polar">Polar band</option><option value="circle">Circle around a point</option><option value="sites">Curated sites</option>
        </select>
      </label>
      {r.type === 'polar' && (
        <div className="row">
          <label>Min lat<NumInput value={r.min_lat} min={-90} max={90} onChange={(v) => onChange({ ...r, min_lat: v })} /></label>
          <label>Max lat<NumInput value={r.max_lat} min={-90} max={90} onChange={(v) => onChange({ ...r, max_lat: v })} /></label>
        </div>
      )}
      {r.type === 'circle' && (
        <div className="row">
          <label>Lat<NumInput value={r.lat} onChange={(v) => onChange({ ...r, lat: v })} /></label>
          <label>Lon<NumInput value={r.lon} onChange={(v) => onChange({ ...r, lon: v })} /></label>
          <label>Radius km<NumInput value={r.radius_km} min={1} onChange={(v) => onChange({ ...r, radius_km: v })} /></label>
        </div>
      )}
      {r.type === 'sites' && (
        <>
          <input className="txt" placeholder="Filter sites…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="checklist">
            {shown.map((x) => (
              <label key={x.id} className="check">
                <input type="checkbox" checked={r.ids.includes(x.id)} onChange={(e) => onChange({ type: 'sites', ids: e.target.checked ? [...r.ids, x.id] : r.ids.filter((i) => i !== x.id) })} />
                {x.name}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function MetricSelect({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const edu = useStore((s) => s.educator);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {RANKABLE.map((m) => <option key={m.name} value={m.name}>{metricLabel(m.name, edu)}</option>)}
    </select>
  );
}

export function FilterEditor({ f, onChange, onRemove }: { f: Filter; onChange: (f: Filter) => void; onRemove?: () => void }) {
  const unit = METRIC_BY_NAME[f.metric]?.unit ?? '';
  return (
    <div className="row ed-row">
      <MetricSelect value={f.metric} onChange={(metric) => {
        const d = METRIC_BY_NAME[metric];
        onChange({ metric, op: d?.defaultOp ?? f.op, value: d?.defaultValue ?? f.value });
      }} />
      <select className="op" value={f.op} onChange={(e) => onChange({ ...f, op: e.target.value as Filter['op'] })}>
        {['<', '<=', '>', '>='].map((o) => <option key={o} value={o}>{o === '<=' ? '≤' : o === '>=' ? '≥' : o}</option>)}
      </select>
      <NumInput value={f.value} onChange={(value) => onChange({ ...f, value })} aria-label="Filter value" />
      <span className="unit">{unit}</span>
      {onRemove && <button className="icon-btn" aria-label="Remove filter" onClick={onRemove}>{'×'}</button>}
    </div>
  );
}

export function ObjectiveEditor({ o, onChange, onRemove }: { o: Objective; onChange: (o: Objective) => void; onRemove?: () => void }) {
  return (
    <div className="row ed-row">
      <MetricSelect value={o.metric} onChange={(metric) => onChange({ ...o, metric })} />
      <button className="btn sm" onClick={() => onChange({ ...o, dir: o.dir === 'max' ? 'min' : 'max' })}>{o.dir === 'max' ? '▲ max' : '▼ min'}</button>
      {onRemove && <button className="icon-btn" aria-label="Remove objective" onClick={onRemove}>{'×'}</button>}
    </div>
  );
}

export function newFilter(): Filter {
  const m = METRIC_BY_NAME.slope_deg;
  return { metric: m.name, op: m.defaultOp ?? '<=', value: m.defaultValue ?? 8 };
}
export function newObjective(existing: Objective[]): Objective {
  const used = new Set(existing.map((o) => o.metric));
  const pick = RANKABLE.find((m) => !used.has(m.name) && m.kind === 'window') ?? RANKABLE[0];
  return { metric: pick.name, dir: 'max' };
}
