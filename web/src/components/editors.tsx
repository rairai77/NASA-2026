import { useEffect, useMemo, useRef, useState } from 'react';
import type { Filter, Objective, Query } from '../engine/api.ts';
import { RANKABLE, METRIC_BY_NAME, metricLabel } from '../query/metrics.ts';
import { addDays, fmtWindowIncl, regionIsCoarse } from '../query/query.ts';
import { WINDOW_MAX, WINDOW_MIN, useStore, windowProblem } from '../store.ts';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, TriangleAlert, X } from 'lucide-react';
import { Button, IconButton, NumInput } from './ui.tsx';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function WindowEditor({ q, onChange }: { q: Query; onChange: (w: Query['window']) => void }) {
  const s = q.window.start.slice(0, 10), e = q.window.end.slice(0, 10);
  const [ds, setDs] = useState(s), [de, setDe] = useState(e);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { setDs(s); setDe(e); }, [s, e]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const problem = DATE_RE.test(ds) && DATE_RE.test(de) ? windowProblem({ start: ds, end: de }) : 'Enter complete dates';
  const commit = (a: string, b: string) => {
    clearTimeout(timer.current);
    if (!DATE_RE.test(a) || !DATE_RE.test(b) || windowProblem({ start: a, end: b })) return;
    if (a !== s || b !== e) onChange({ start: a, end: b });
  };
  const edit = (a: string, b: string, now = false) => {
    setDs(a); setDe(b);
    clearTimeout(timer.current);
    if (now) commit(a, b); else timer.current = setTimeout(() => commit(a, b), 400);
  };
  const shift = (d: number) => edit(addDays(ds, d), addDays(de, d), true);
  const key = (ev: React.KeyboardEvent) => { if (ev.key === 'Enter') commit(ds, de); };
  const onStart = (v: string) => edit(v, DATE_RE.test(v) && v >= de && !windowProblem({ start: v, end: addDays(v, 1) }) ? addDays(v, 1) : de);
  return (
    <div className="ed">
      <label>Start (UTC)<input type="date" value={ds} min={WINDOW_MIN} max={WINDOW_MAX} aria-invalid={!!problem} onChange={(ev) => onStart(ev.target.value)} onBlur={() => commit(ds, de)} onKeyDown={key} /></label>
      <label>Last day (UTC)<input type="date" value={DATE_RE.test(de) ? addDays(de, -1) : de} min={WINDOW_MIN} max={addDays(WINDOW_MAX, -1)} aria-invalid={!!problem} onChange={(ev) => edit(ds, DATE_RE.test(ev.target.value) ? addDays(ev.target.value, 1) : ev.target.value)} onBlur={() => commit(ds, de)} onKeyDown={key} /></label>
      {!problem && <p className="hint">{fmtWindowIncl(ds, de)}, both days included</p>}
      {problem && <p className="hint warnline" role="alert"><TriangleAlert aria-hidden size={13} /> {problem}</p>}
      <div className="ed-lbl">Shift the window</div>
      <div className="row shift">
        <Button size="sm" icon={ChevronLeft} onClick={() => shift(-30)}>30 d</Button>
        <Button size="sm" iconRight={ChevronRight} onClick={() => shift(30)}>30 d</Button>
        <Button size="sm" icon={ChevronLeft} onClick={() => shift(-91)}>3 mo</Button>
        <Button size="sm" iconRight={ChevronRight} onClick={() => shift(91)}>3 mo</Button>
      </div>
      <div className="ed-lbl">Or set its length</div>
      <div className="row shift">
        {[7, 30, 90, 365].map((d) => <Button key={d} size="sm" variant="ghost" onClick={() => edit(ds, addDays(ds, d), true)}>{d} d</Button>)}
      </div>
    </div>
  );
}

export function RegionEditor({ q, onChange }: { q: Query; onChange: (r: Query['region']) => void }) {
  const sites = useStore((st) => st.sites);
  const r = q.region;
  const [filter, setFilter] = useState('');
  // "Circle around a site" waits for a site or centre before it ranks (the default centre would fall into coarse mode)
  const [pendingCircle, setPendingCircle] = useState(false);
  const shown = useMemo(() => sites.filter((x) => x.name.toLowerCase().includes(filter.toLowerCase())), [sites, filter]);
  return (
    <div className="ed">
      <label>Region
        <select value={pendingCircle ? 'circle' : r.type} onChange={(ev) => {
          const t = ev.target.value;
          setPendingCircle(t === 'circle' && r.type !== 'circle');
          if (t === 'circle') return; // keeps the current circle, or waits for a centre
          if (t === 'polar') onChange({ type: 'polar', min_lat: -90, max_lat: -85 });
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
          <label>From latitude (°)<NumInput value={r.min_lat} min={-90} max={90} onChange={(v) => onChange({ ...r, min_lat: v })} /></label>
          <label>To latitude (°)<NumInput value={r.max_lat} min={-90} max={90} onChange={(v) => onChange({ ...r, max_lat: v })} /></label>
        </div>
      )}
      {r.type === 'polar' && (
        <p className="hint">South is negative: {'−'}90{'°'} is the pole.</p>
      )}
      {(r.type === 'circle' || pendingCircle) && (() => {
        const c = r.type === 'circle' ? r : { type: 'circle' as const, lat: -85, lon: 0, radius_km: 100 };
        const commit = (n: typeof c) => { setPendingCircle(false); onChange(n); };
        return (
          <>
            <label>Centre on a site
              <select value="" onChange={(ev) => { const x = sites.find((y) => y.id === ev.target.value); if (x) commit({ ...c, lat: x.lat, lon: x.lon }); }}>
                <option value="">Pick a site…</option>
                {sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            {pendingCircle && <p className="hint">Pick a site, or type a centre below, to start the search.</p>}
            <div className="row">
              <label>Centre latitude (°)<NumInput value={c.lat} onChange={(v) => commit({ ...c, lat: v })} /></label>
              <label>Centre longitude (°)<NumInput value={c.lon} onChange={(v) => commit({ ...c, lon: v })} /></label>
              <label>Radius (km)<NumInput value={c.radius_km} min={1} onChange={(v) => commit({ ...c, radius_km: v })} /></label>
            </div>
          </>
        );
      })()}
      {r.type === 'bbox' && (
        <>
          <div className="row">
            <label>South latitude (°)<NumInput value={r.south} min={-90} max={90} onChange={(v) => onChange({ ...r, south: v })} /></label>
            <label>North latitude (°)<NumInput value={r.north} min={-90} max={90} onChange={(v) => onChange({ ...r, north: v })} /></label>
          </div>
          <div className="row">
            <label>West longitude (°)<NumInput value={r.west} min={-180} max={360} onChange={(v) => onChange({ ...r, west: v })} /></label>
            <label>East longitude (°)<NumInput value={r.east} min={-180} max={360} onChange={(v) => onChange({ ...r, east: v })} /></label>
          </div>
          <p className="hint">West greater than east wraps across the antimeridian (180{'°'}).</p>
        </>
      )}
      {r.type === 'global' && <p className="hint">Searches every ~10 km cell on the Moon.</p>}
      {regionIsCoarse(r) && <p className="hint warnline"><TriangleAlert aria-hidden size={13} /> This area reaches north of 85{'°'} S, so it uses the coarse 10 km global grid.</p>}
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
      {coarse && METRIC_BY_NAME[f.metric]?.polarOnly && <span className="hint warnline" title="Not available on the 10 km global grid"><TriangleAlert aria-hidden size={12} /> fails on the global grid</span>}
      {onRemove && <IconButton icon={X} label="Remove filter" size="sm" tip="none" onClick={onRemove} />}
    </div>
  );
}

export function ObjectiveEditor({ o, onChange, onRemove }: { o: Objective; onChange: (o: Objective) => void; onRemove?: () => void }) {
  return (
    <div className="row ed-row">
      <MetricSelect value={o.metric} onChange={(metric) => onChange({ ...o, metric })} />
      <Button size="sm" icon={o.dir === 'max' ? ArrowUp : ArrowDown} title="Toggle maximise / minimise" onClick={() => onChange({ ...o, dir: o.dir === 'max' ? 'min' : 'max' })}>{o.dir === 'max' ? 'Max' : 'Min'}</Button>
      {onRemove && <IconButton icon={X} label="Remove objective" size="sm" tip="none" onClick={onRemove} />}
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
