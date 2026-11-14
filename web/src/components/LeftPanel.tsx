import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, PanelLeftOpen, ChevronRight, CircleDashed, GitCompare, History, Info, Layers, ListOrdered, MapPin, Plus, Search, SearchX, Spline, Sun } from 'lucide-react';
import type { VisResult } from '../engine/api.ts';
import { getEngine } from '../engine/client.ts';
import { placeFor } from '../lib/places.ts';
import { METRIC_BY_NAME, metricLabel } from '../query/metrics.ts';
import { describeRegion } from '../query/query.ts';
import { MAX_COMPARE, flyTo, patchQuery, runRank, select, setLayerState, toggleCompare, useStore, windowOf, type LeftTab, type Target } from '../store.ts';
import { DiffTab } from './DiffTab.tsx';
import { LaneStrip } from './LaneStrip.tsx';
import { ReplayTab } from './ReplayTab.tsx';
import { Button, IconButton, Skeleton, Stat, Tabs, Tag, Tooltip, Why } from './ui.tsx';

export const COLORS = { sun: '#F5B700', earth: '#4FA3FF', both: '#FFFFFF', eclipse: '#FF4FD8' };

const sparkCache = new Map<string, Promise<VisResult>>();
export function useSpark(t: Target | undefined, win: [number, number]) {
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

export const COMPARE_TIP = 'Show this site as an extra row on the timeline to compare it with others';
/** "Compare": add / remove a site as an extra row on the timeline (the compare list). */
export function TimelineToggle({ id, size = 'sm', compact }: { id: string; size?: 'sm' | 'md'; compact?: boolean }) {
  const on = useStore((s) => s.compare.includes(id));
  const full = useStore((s) => s.compare.length >= MAX_COMPARE);
  const tip = on ? 'Remove this site from the timeline comparison' : full ? `Timeline is full (${MAX_COMPARE} sites). Remove one first.` : COMPARE_TIP;
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {compact
        ? <IconButton icon={on ? Check : Plus} label={on ? 'Comparing: remove from timeline' : 'Compare on the timeline'} size={size} active={on} tip="left" className="pn-add" onClick={() => toggleCompare(id)} />
        : <Tooltip content={tip} side="bottom" wrap>
            <Button size="sm" icon={on ? Check : Plus} active={on} className="pn-add" disabled={!on && full} aria-label={`Compare: ${tip}`} onClick={() => toggleCompare(id)}>Compare</Button>
          </Tooltip>}
    </span>
  );
}

const SHORT: Record<string, string> = {
  sun_hours: 'Sun', earth_hours: 'Earth', both_hours: 'Sun + Earth', longest_sun_h: 'Longest Sun', longest_both_h: 'Longest both', longest_dark_h: 'Longest dark',
  longest_earth_h: 'Longest Earth', comms_hours: 'Comms', slope_deg: 'Slope', sun_frac: 'Sun share', mean_sun_el_deg: 'Mean Sun el.', energy_wh: 'Energy', battery_wh_needed: 'Battery',
  eclipse_hours: 'Eclipse', elev_m: 'Elevation', psr_dist_km: 'To PSR', fault_dist_km: 'To fault', longest_comms_h: 'Longest comms', min_sun_el_deg: 'Min Sun el.',
};
function statValue(name: string, v: number | undefined): { value: string; unit: string } {
  const m = METRIC_BY_NAME[name];
  if (v === undefined || v === null || Number.isNaN(v)) return { value: '—', unit: '' };
  const u = m?.unit ?? '';
  return { value: v.toFixed(m?.digits ?? 1), unit: u };
}
const toneOf = (name: string): 'sun' | 'earth' | 'ok' | undefined => (/^(sun|longest_sun|mean_sun|min_sun)/.test(name) ? 'sun' : /earth|comms|both/.test(name) ? 'earth' : 'ok');

function regionLabel(q: ReturnType<typeof useStore.getState>['query']): string {
  const r = q.region;
  if (r.type === 'polar') return r.max_lat <= -85 || r.min_lat < 0 ? `South polar cap ${Math.abs(r.max_lat)}–${Math.abs(r.min_lat)}° S` : describeRegion(r);
  const d = describeRegion(r);
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function ResultCard({ id, rank, coarse, cols, win }: { id: string; rank: number; coarse?: boolean; cols: string[]; win: [number, number] }) {
  const t = useStore((s) => s.targets[id]);
  const sites = useStore((s) => s.sites);
  const selected = useStore((s) => s.selected === id);
  const edu = useStore((s) => s.educator);
  const vis = useSpark(t, win);
  const place = useMemo(() => (t ? (t.kind === 'site' ? null : placeFor(t.lat, t.lon, sites)) : null), [t, sites]);
  if (!t) return null;
  const choose = () => { select(id); flyTo(id); };
  return (
    <li
      className={`pn-card ${selected ? 'is-sel' : ''}`} tabIndex={0} role="button" aria-pressed={selected}
      aria-label={`Rank ${rank}, ${place?.title ?? t.name}`}
      onClick={choose}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } }}
      onMouseEnter={() => useStore.setState({ hoveredId: id })} onMouseLeave={() => useStore.setState({ hoveredId: null })}
      onFocus={() => useStore.setState({ hoveredId: id })} onBlur={() => useStore.setState({ hoveredId: null })}
    >
      <div className="pn-card-top">
        <span className={`pn-rank ${rank === 1 ? 'is-gold' : ''}`} aria-hidden>{rank}</span>
        <div className="pn-card-title">
          <b title={place?.title ?? t.name}>{place?.title ?? t.name}</b>
          <span className="mono">{place?.distLabel && <span className="pn-dist">{place.distLabel} · </span>}{t.lat.toFixed(3)}°, {t.lon.toFixed(3)}°{coarse && <em title="Found on the coarse 10 km global grid"> · coarse 10 km</em>}</span>
        </div>
        <TimelineToggle id={id} />
      </div>
      <div className="pn-stats">
        {cols.map((c, i) => {
          const sv = statValue(c, t.metrics?.[c]);
          return <Stat key={c} label={SHORT[c] ?? metricLabel(c, edu)} value={sv.value} unit={sv.unit} tone={i === 0 ? toneOf(c) : undefined} title={metricLabel(c, edu)} />;
        })}
      </div>
      <LaneStrip vis={vis} win={win} />
    </li>
  );
}

function ResultsTab() {
  const results = useStore((s) => s.results);
  const q = useStore((s) => s.query);
  const ranking = useStore((s) => s.ranking);
  const progress = useStore((s) => s.progress);
  const rankSkipped = useStore((s) => s.rankSkipped);
  const win = useMemo(() => windowOf(q), [q]);
  const cols = useMemo(() => {
    const names = [...q.objectives.map((o) => o.metric), ...q.filters.map((f) => f.metric)];
    const u = [...new Set(names)];
    for (const extra of ['sun_hours', 'earth_hours', 'longest_both_h', 'slope_deg']) if (u.length < 3 && !u.includes(extra)) u.push(extra);
    return u.slice(0, 3);
  }, [q]);

  if (ranking) {
    const pct = progress ? Math.min(100, (100 * progress.done) / Math.max(1, progress.total)) : 4;
    return (
      <div className="pn-body" aria-busy="true">
        <div className="pn-head">
          <h2 className="pn-h">Ranking sites</h2>
          <p className="pn-sub">{progress?.stage ?? 'Starting'}{'…'} <span className="mono">{Math.round(pct)}%</span></p>
          <div className="pn-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
        </div>
        <ol className="pn-list">
          {[0, 1, 2].map((i) => (
            <li key={i} className="pn-card pn-card--skel" aria-hidden>
              <div className="pn-card-top"><Skeleton w={24} h={24} /><div className="pn-card-title"><Skeleton w="70%" h={14} /><Skeleton w="45%" h={11} /></div></div>
              <div className="pn-stats"><Skeleton h={30} /><Skeleton h={30} /><Skeleton h={30} /></div>
              <Skeleton h={30} />
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (rankSkipped && !results) {
    return (
      <div className="pn-body">
        <div className="pn-empty">
          <span className="pn-empty-ic"><Info aria-hidden /></span>
          <b>No ranking for these dates</b>
          <p>Ranking covers 2026{'–'}2030; site timelines still work back to 2023. Pick a site on the globe or in Sites to see its timeline.</p>
        </div>
      </div>
    );
  }

  if (!results || results.results.length === 0) {
    const last = q.filters[q.filters.length - 1];
    return (
      <div className="pn-body">
        <div className="pn-empty">
          <span className="pn-empty-ic">{results ? <SearchX aria-hidden /> : <Search aria-hidden />}</span>
          <b>{results ? 'No site passes all filters' : 'No ranking yet'}</b>
          <p>{results ? 'Nothing in this window and region meets every filter. Relax one, widen the region or move the window.' : 'Ask a question in the bar above, or run the current query.'}</p>
          {results && last
            ? <Button variant="primary" size="sm" icon={SearchX} onClick={() => patchQuery({ filters: q.filters.slice(0, -1) })}>Drop “{metricLabel(last.metric)}” filter</Button>
            : <Button variant="primary" size="sm" icon={Search} onClick={() => runRank()}>Run search</Button>}
        </div>
      </div>
    );
  }

  const n = results.results.length;
  const res = results.resolutionM;
  const grid = results.coarse ? `~${Math.round(res / 1000)} km cells (coarse)` : res >= 1000 ? `${res / 1000} km grid` : `${res} m terrain`;
  const refine = results.coarse ? '6 h steps' : `refined at 15 min`;
  return (
    <div className="pn-body">
      <div className="pn-head">
        <h2 className="pn-h" title={`${results.considered.toLocaleString()} cells considered, ${results.passedFilters.toLocaleString()} pass your filters`}>
          Best {n} of {results.passedFilters.toLocaleString()} {results.considered > n ? 'cells' : 'candidates'}
        </h2>
        <p className="pn-sub">{regionLabel(q)} {'·'} {grid} {'·'} {refine}{results.model === 'mock' ? ' · demo' : ''}</p>
      </div>
      {results.coarse && (
        <div className="pn-warn" role="note">
          <Tag tone="warn" title="Global search uses ~10 km cells, 6-hour steps and 1 km-baseline slopes">Coarse {Math.round(res / 1000)} km screening</Tag>
          <p>Not 20 m answers. Use these as leads: select one, then inspect its horizon and timeline, or search a polar region for 20 m results.</p>
        </div>
      )}
      <ol className="pn-list">
        {results.results.map((r) => {
          const id = r.id ?? `r:${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
          return <ResultCard key={id} id={id} rank={r.rank} coarse={r.coarse} cols={cols} win={win} />;
        })}
      </ol>
      <div className="pn-legend"><i style={{ background: 'var(--sun)' }} />Sun <i style={{ background: 'var(--earth)' }} />Earth <i style={{ background: 'var(--both)', border: '1px solid var(--border-strong)' }} />Both up <span>{'·'} tick = timeline cursor</span></div>
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
    <div className="pn-body">
      <label className="pn-search">
        <Search aria-hidden />
        <input type="search" placeholder="Search sites" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search sites" />
      </label>
      <p className="pn-hint">Use <b>Compare</b> <Plus aria-hidden className="pn-inline-ic" /> to show up to {MAX_COMPARE} sites as rows on one timeline.</p>
      {groups.map(([g, list]) => (
        <section key={g} className="pn-group">
          <button className="pn-group-h" onClick={() => setClosed({ ...closed, [g]: !closed[g] })} aria-expanded={!closed[g]}>
            {closed[g] ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}<span>{g}</span><small>{list.length}</small>
          </button>
          {!closed[g] && (
            <ul>
              {list.map((s) => (
                <li key={s.id} className={`pn-row ${selected === s.id ? 'is-sel' : ''}`} tabIndex={0}
                  onClick={() => { select(s.id); flyTo(s.id); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { select(s.id); flyTo(s.id); } }}
                  onMouseEnter={() => useStore.setState({ hoveredId: s.id })} onMouseLeave={() => useStore.setState({ hoveredId: null })}>
                  <span className="pn-row-name">{s.name}</span>
                  {s.representative && <Tag title="A single point stands in for a larger region">rep.</Tag>}
                  <TimelineToggle id={s.id} compact />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {groups.length === 0 && <p className="pn-hint">No sites match “{filter}”.</p>}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="pn-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span aria-hidden />
    </label>
  );
}

function LayersTab() {
  const layers = useStore((s) => s.layers);
  const defs = useStore((s) => s.layerDefs);
  const lstate = useStore((s) => s.layerState);
  const set = (p: Partial<typeof layers>) => useStore.setState({ layers: { ...layers, ...p } });
  const rows: { k: 'sites' | 'results' | 'faults' | 'keepout' | 'shadows'; label: string; icon: typeof Sun; why?: string }[] = [
    { k: 'sites', label: 'Curated sites', icon: MapPin },
    { k: 'results', label: 'Ranked results', icon: ListOrdered },
    { k: 'shadows', label: 'Terrain-true shadows (LOLA)', icon: Sun, why: 'shadows' },
    { k: 'faults', label: 'Fault scarps', icon: Spline, why: 'lobate-scarps' },
    { k: 'keepout', label: 'Keep-out circles around landers', icon: CircleDashed },
  ];
  return (
    <div className="pn-body">
      <h3 className="ui-section-title">Map overlays</h3>
      <div className="pn-stack">
        {rows.map((r) => (
          <div key={r.k} className="pn-lrow-wrap">
            <div className="pn-lrow">
              <r.icon aria-hidden className="pn-lrow-ic" />
              <span className="pn-lrow-t">{r.label}{r.why && <Why id={r.why} />}</span>
              <Switch checked={layers[r.k]} onChange={(v) => set({ [r.k]: v })} label={r.label} />
            </div>
            {r.k === 'keepout' && layers.keepout && (
              <label className="pn-slider">
                <span>Radius</span>
                <input type="range" min={0.5} max={50} step={0.5} value={layers.keepoutKm} onChange={(e) => set({ keepoutKm: parseFloat(e.target.value) })} />
                <b className="mono">{layers.keepoutKm} km</b>
              </label>
            )}
          </div>
        ))}
      </div>
      <h3 className="ui-section-title">Context layers</h3>
      {defs.length === 0 && <p className="pn-hint">No layer tiles found in /data/layers yet.</p>}
      <div className="pn-stack">
        {defs.map((d) => {
          const st = lstate[d.id] ?? { on: false, opacity: 1 };
          const stops = d.legend.stops;
          const span = d.legend.max - d.legend.min || 1;
          const grad = stops.length > 1
            ? `linear-gradient(90deg, ${stops.map(([v, c]) => `${c} ${Math.max(0, Math.min(100, ((v - d.legend.min) / span) * 100))}%`).join(', ')})`
            : stops[0]?.[1] ?? '#22d3ee';
          return (
            <div key={d.id} className={`pn-lcard ${st.on ? 'is-on' : ''}`}>
              <div className="pn-lrow">
                <Layers aria-hidden className="pn-lrow-ic" />
                <span className="pn-lrow-t">{d.title}{d.id === 'psr' && <Why id="psr" />}</span>
                <Tooltip content={<>{d.source}{d.citation && <><br /><br />{d.citation}</>}</>} side="left" wrap>
                  <button className="ui-icon-btn ui-icon-btn--sm" aria-label={`Source: ${d.source}`}><Info aria-hidden /></button>
                </Tooltip>
                <Switch checked={st.on} onChange={(v) => setLayerState(d.id, { on: v })} label={d.title} />
              </div>
              {st.on && (
                <div className="pn-lbody">
                  <div className="pn-legendbar" style={{ background: grad }} />
                  <div className="pn-legendlbl mono"><span>{d.legend.min}{d.units && d.units !== 'mask' ? ` ${d.units}` : ''}</span><span>{d.units === 'mask' ? 'Mask' : `${d.legend.max}${d.units ? ` ${d.units}` : ''}`}</span></div>
                  <label className="pn-slider">
                    <span>Opacity</span>
                    <input type="range" min={0.1} max={1} step={0.05} value={st.opacity} onChange={(e) => setLayerState(d.id, { opacity: parseFloat(e.target.value) })} />
                    <b className="mono">{Math.round(st.opacity * 100)}%</b>
                  </label>
                  <small className="pn-src">{d.source}</small>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LeftPanel({ allowCollapse = true }: { allowCollapse?: boolean }) {
  const tab = useStore((s) => s.leftTab);
  const collapsed = useStore((s) => s.leftCollapsed) && allowCollapse;
  const nRes = useStore((s) => s.results?.results.length ?? 0);
  const nSites = useStore((s) => s.sites.length);
  const layers = useStore((s) => s.layers);
  const lstate = useStore((s) => s.layerState);
  const nLayers = Object.values(layers).filter((v) => v === true).length + Object.values(lstate).filter((l) => l.on).length;
  const L = (text: string) => <span className="pn-tl">{text}</span>;
  const tabs: { id: LeftTab; label: React.ReactNode; icon: typeof Layers; count?: number; title: string }[] = [
    { id: 'results', label: L('Results'), icon: ListOrdered, count: nRes || undefined, title: 'Results: ranked sites' },
    { id: 'sites', label: L('Sites'), icon: MapPin, count: nSites || undefined, title: 'Sites: curated landing sites' },
    { id: 'layers', label: L('Layers'), icon: Layers, count: nLayers || undefined, title: 'Layers: map overlays' },
    { id: 'replay', label: L('Mission check'), icon: History, title: 'Mission check: did we predict when real landers lost sunlight?' },
    { id: 'diff', label: L('Compare dates'), icon: GitCompare, title: 'Compare dates: save two date windows and see what changes' },
  ];
  const setCollapsed = (v: boolean) => useStore.setState({ leftCollapsed: v });
  if (collapsed) {
    return (
      <aside className="left pn-left pn-rail" aria-label="Sites and results (collapsed)">
        <IconButton icon={PanelLeftOpen} label="Expand the left panel ( [ )" tip="right" onClick={() => setCollapsed(false)} />
        <span className="pn-rail-sep" />
        {tabs.map((t) => (
          <IconButton key={t.id} icon={t.icon} label={t.title} tip="right" active={t.id === tab} onClick={() => { useStore.setState({ leftTab: t.id, leftCollapsed: false }); }} />
        ))}
      </aside>
    );
  }
  return (
    <aside className="left pn-left" aria-label="Sites and results">
      <div className="pn-tabrow">
        <Tabs className="pn-tabs" tabs={tabs} active={tab} onChange={(k) => useStore.setState({ leftTab: k })} />
        {allowCollapse && <IconButton className="pn-collapse" icon={ChevronLeft} label="Collapse the left panel ( [ )" tip="bottom" onClick={() => setCollapsed(true)} />}
      </div>
      <div className="pn-scroll" role="tabpanel">
        {tab === 'results' && <ResultsTab />}
        {tab === 'sites' && <SitesTab />}
        {tab === 'layers' && <LayersTab />}
        {tab === 'replay' && <ReplayTab />}
        {tab === 'diff' && <DiffTab />}
      </div>
    </aside>
  );
}
