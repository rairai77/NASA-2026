import { useMemo, useState } from 'react';
import type { Filter, Objective, Query } from '../engine/api.ts';
import { RANKABLE, METRIC_BY_NAME, metricLabel } from '../query/metrics.ts';
import { addDays, regionIsCoarse } from '../query/query.ts';
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
      <label>Region
        <select value={r.type} onChange={(ev) => {
          const t = ev.target.value;
          if (t === 'polar') onChange({ type: 'polar', min_lat: -90, max_lat: -85 });
          else if (t === 'circle') onChange({ type: 'circle', lat: -85, lon: 0, radius_km: 100 });
          else if (t === 'bbox') onChange({ type: 'bbox', west: -20, south: -30, east: 20, north: 10 });
          else if (t === 'global') onChange({ type: 'global' });
          else onChange({ type: 'sites', ids: sites.slice(0, 4).map((x) => x.id) });
        }}>
          <option value="polar">South pole (lat range)</option>
          <option value="circle">Circle around a site</option>
          <option value="bbox">Box (lat/lon bounds)</option>
          <option value="global">Whole Moon</option>
          <option value="sites">Curated sites</option>
        </select>
      </label>
      {r.type === 'polar' && (
        <div className="row">
          <label>Min lat<NumInput value={r.min_lat} min={-90} max={90} onChange={(v) => onChange({ ...r, min_lat: v })} /></label>
          <label>Max lat<NumInput value={r.max_lat} min={-90} max={90} onChange={(v) => onChange({ ...r, max_lat: v })} /></label>
        </div>
      )}
      {r.type === 'circle' && (
        <>
          <label>Centre on a site
            <select value="" onChange={(ev) => { const x = sites.find((y) => y.id === ev.target.value); if (x) onChange({ ...r, lat: x.lat, lon: x.lon }); }}>
              <option value="">Pick a site…</option>
              {sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <div className="row">
            <label>Lat<NumInput value={r.lat} onChange={(v) => onChange({ ...r, lat: v })} /></label>
            <label>Lon<NumInput value={r.lon} onChange={(v) => onChange({ ...r, lon: v })} /></label>
            <label>Radius km<NumInput value={r.radius_km} min={1} onChange={(v) => onChange({ ...r, radius_km: v })} /></label>
          </div>
        </>
      )}
      {r.type === 'bbox' && (
        <>
          <div className="row">
            <label>South lat<NumInput value={r.south} min={-90} max={90} onChange={(v) => onChange({ ...r, south: v })} /></label>
            <label>North lat<NumInput value={r.north} min={-90} max={90} onChange={(v) => onChange({ ...r, north: v })} /></label>
          </div>
          <div className="row">
            <label>West lon<NumInput value={r.west} min={-180} max={360} onChange={(v) => onChange({ ...r, west: v })} /></label>
            <label>East lon<NumInput value={r.east} min={-180} max={360} onChange={(v) => onChange({ ...r, east: v })} /></label>
          </div>
          <p className="hint">West greater than east wraps across the antimeridian (180{'°'}).</p>
        </>
      )}
      {r.type === 'global' && <p className="hint">Searches every ~10 km cell on the Moon.</p>}
      {regionIsCoarse(r) && <p className="hint warnline">{'⚠'} Coarse 10 km screening: this region reaches outside the south polar cap (below {'−'}85{'°'}), so it uses the global grid (10 km cells, 6 h steps). Distance-to-PSR and distance-to-fault filters do not work there.</p>}
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
  const coarse = useStore((s) => regionIsCoarse(s.query.region));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {RANKABLE.map((m) => {
        const off = coarse && m.polarOnly && m.name !== value;
        return <option key={m.name} value={m.name} disabled={off}>{metricLabel(m.name, edu)}{coarse && m.polarOnly ? ' (polar only)' : ''}</option>;
      })}
    </select>
  );
}

export function FilterEditor({ f, onChange, onRemove }: { f: Filter; onChange: (f: Filter) => void; onRemove?: () => void }) {
  const unit = METRIC_BY_NAME[f.metric]?.unit ?? '';
  const coarse = useStore((st) => regionIsCoarse(st.query.region));
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
      {coarse && METRIC_BY_NAME[f.metric]?.polarOnly && <span className="hint warnline" title="Not available on the 10 km global grid">{'⚠'} fails on the global grid</span>}
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
