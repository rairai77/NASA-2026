import { useEffect, useMemo, useRef, useState } from 'react';
import type { VisResult } from '../engine/api.ts';
import { getEngine } from '../engine/client.ts';
import { fmtMetric, metricLabel } from '../query/metrics.ts';
import { MAX_COMPARE, flyTo, select, toggleCompare, useStore, windowOf, type LeftTab, type Target } from '../store.ts';
import { Badge, Why } from './ui.tsx';

export const COLORS = { sun: '#F5B700', earth: '#4FA3FF', both: '#FFFFFF', eclipse: '#FF4FD8' };

const sparkCache = new Map<string, Promise<VisResult>>();
function useSpark(t: Target | undefined, win: [number, number]) {
  const [v, setV] = useState<VisResult | null>(null);
  useEffect(() => {
    if (!t) return;
    const key = `${t.lat.toFixed(4)},${t.lon.toFixed(4)}|${win[0]}|${win[1]}`;
    let p = sparkCache.get(key);
    if (!p) {
      p = getEngine().visibility(t.lat, t.lon, win[0], win[1], { stepS: Math.max(3600, Math.ceil((win[1] - win[0]) / 400 / 900) * 900) });
      sparkCache.set(key, p);
      if (sparkCache.size > 300) sparkCache.delete(sparkCache.keys().next().value!);
    }
    let live = true;
    p.then((r) => live && setV(r)).catch(() => {});
    return () => { live = false; };
  }, [t?.lat, t?.lon, win[0], win[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

export function Sparkline({ target, win }: { target: Target; win: [number, number] }) {
  const v = useSpark(target, win);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 140, H = 22;
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(0, 0, W, H);
    if (!v) return;
    const n = v.t.length;
    for (let x = 0; x < W; x++) {
      const a = Math.floor((x / W) * n), b = Math.max(a + 1, Math.floor(((x + 1) / W) * n));
      let su = 0, ea = 0, bo = 0;
      for (let i = a; i < b; i++) { const s = v.sunFrac[i] >= 0.5, e = v.earthUp[i] === 1; if (s) su++; if (e) ea++; if (s && e) bo++; }
      const m = b - a;
      g.globalAlpha = su / m; g.fillStyle = COLORS.sun; g.fillRect(x, 1, 1, 8);
      g.globalAlpha = ea / m; g.fillStyle = COLORS.earth; g.fillRect(x, 10, 1, 7);
      g.globalAlpha = bo / m; g.fillStyle = COLORS.both; g.fillRect(x, 18, 1, 3);
    }
    g.globalAlpha = 1;
  }, [v]);
  return <canvas ref={ref} className="spark" style={{ width: 140, height: 22 }} aria-label="Sun and Earth visibility over the window" />;
}

function CompareCheck({ id }: { id: string }) {
  const on = useStore((s) => s.compare.includes(id));
  const full = useStore((s) => s.compare.length >= MAX_COMPARE);
  return (
    <label className="cmp" title={on ? 'Remove from compare' : full ? 'Compare is full (4)' : 'Add to compare'} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={on} onChange={() => toggleCompare(id)} aria-label="Compare" />
    </label>
  );
}

function ResultsTab() {
  const results = useStore((s) => s.results);
  const q = useStore((s) => s.query);
  const targets = useStore((s) => s.targets);
  const selected = useStore((s) => s.selected);
  const ranking = useStore((s) => s.ranking);
  const progress = useStore((s) => s.progress);
  const edu = useStore((s) => s.educator);
  const win = useMemo(() => windowOf(q), [q]);
  const cols = useMemo(() => {
    const names = [...q.objectives.map((o) => o.metric), ...q.filters.map((f) => f.metric)];
    const u = [...new Set(names)];
    for (const extra of ['slope_deg', 'longest_both_h']) if (u.length < 3 && !u.includes(extra)) u.push(extra);
    return u.slice(0, 3);
  }, [q]);
  return (
    <div className="tab-body">
      {ranking && (
        <div className="progress" role="progressbar">
          <div className="bar" style={{ width: `${progress ? Math.min(100, (100 * progress.done) / Math.max(1, progress.total)) : 5}%` }} />
          <span>{progress?.stage ?? 'Ranking'}{'…'}</span>
        </div>
      )}
      {results && !ranking && (
        <p className="summary">{results.passedFilters.toLocaleString()} of {results.considered.toLocaleString()} candidates pass your filters
          {' · '}{results.resolutionM} m terrain{results.model === 'mock' ? ' (demo)' : ''}</p>
      )}
      {results && results.results.length === 0 && !ranking && <p className="empty">No site passes all filters in this window. Relax a filter chip or move the window.</p>}
      <ol className="reslist">
        {results?.results.map((r) => {
          const id = r.id ?? `r:${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
          const t = targets[id];
          if (!t) return null;
          return (
            <li key={id} className={selected === id ? 'sel' : ''} onClick={() => { select(id); flyTo(id); }}>
              <div className="r-top">
                <span className="rank">{r.rank}</span>
                <div className="r-name">
                  <b>{t.name}</b>
                  <small>{r.lat.toFixed(3)}{'°'}, {r.lon.toFixed(3)}{'°'}</small>
                </div>
                <CompareCheck id={id} />
              </div>
              <div className="r-metrics">
                {cols.map((c) => <span key={c} title={metricLabel(c, edu)}><i>{metricLabel(c, edu)}</i>{fmtMetric(c, r.metrics[c]).replace(/ \(.*\)/, '')}</span>)}
              </div>
              <Sparkline target={t} win={win} />
            </li>
          );
        })}
      </ol>
      <div className="legend"><i style={{ background: COLORS.sun }} />Sun <i style={{ background: COLORS.earth }} />Earth <i style={{ background: COLORS.both }} />both</div>
    </div>
  );
}

function SitesTab() {
  const sites = useStore((s) => s.sites);
  const selected = useStore((s) => s.selected);
  const [filter, setFilter] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const g = new Map<string, typeof sites>();
    for (const s of sites) {
      if (filter && !`${s.name} ${s.group}`.toLowerCase().includes(filter.toLowerCase())) continue;
      if (!g.has(s.group)) g.set(s.group, []);
      g.get(s.group)!.push(s);
    }
    return [...g.entries()];
  }, [sites, filter]);
  return (
    <div className="tab-body">
      <input className="txt" placeholder="Search sites…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search sites" />
      <p className="hint">Tick up to {MAX_COMPARE} sites to compare them on one timeline.</p>
      {groups.map(([g, list]) => (
        <section key={g} className="group">
          <button className="group-h" onClick={() => setClosed({ ...closed, [g]: !closed[g] })} aria-expanded={!closed[g]}>
            <span>{closed[g] ? '▸' : '▾'} {g}</span><small>{list.length}</small>
          </button>
          {!closed[g] && (
            <ul>
              {list.map((s) => (
                <li key={s.id} className={selected === s.id ? 'sel' : ''} onClick={() => { select(s.id); flyTo(s.id); }}>
                  <span className="s-name">{s.name}</span>
                  {s.representative && <Badge title="A single point stands in for a larger region">rep.</Badge>}
                  <CompareCheck id={s.id} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {groups.length === 0 && <p className="empty">No sites match.</p>}
    </div>
  );
}

function LayersTab() {
  const layers = useStore((s) => s.layers);
  const set = (p: Partial<typeof layers>) => useStore.setState({ layers: { ...layers, ...p } });
  const Toggle = ({ k, label, hint, disabled }: { k: 'sites' | 'results' | 'faults' | 'psr' | 'keepout'; label: string; hint?: React.ReactNode; disabled?: boolean }) => (
    <label className={`layer ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={layers[k]} disabled={disabled} onChange={(e) => set({ [k]: e.target.checked })} />
      <span>{label}{hint}</span>
    </label>
  );
  return (
    <div className="tab-body">
      <Toggle k="sites" label="Curated sites" />
      <Toggle k="results" label="Ranked results" />
      <Toggle k="faults" label="Fault scarps" hint={<Why id="scarps" />} />
      <Toggle k="psr" label={'Never-sunlit cells (PSR proxy) — coming soon'} disabled />
      <Toggle k="keepout" label="Keep-out circles around landers" />
      <div className="slider">
        <label>Radius <b>{layers.keepoutKm} km</b>
          <input type="range" min={0.5} max={50} step={0.5} value={layers.keepoutKm} onChange={(e) => set({ keepoutKm: parseFloat(e.target.value) })} />
        </label>
      </div>
    </div>
  );
}

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const nCmp = useStore((s) => s.compare.length);
  const tabs: [LeftTab, string][] = [['results', 'Results'], ['sites', 'Sites'], ['layers', 'Layers']];
  return (
    <aside className="left">
      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => useStore.setState({ leftTab: k })}>
            {label}{k === 'sites' && nCmp > 0 ? <span className="count">{nCmp}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'results' && <ResultsTab />}
      {tab === 'sites' && <SitesTab />}
      {tab === 'layers' && <LayersTab />}
    </aside>
  );
}
