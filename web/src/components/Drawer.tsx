import { useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Crosshair, Download, Ellipsis, Eye, Mountain, PanelRightOpen, Plus, Route, Sunrise, Table2, X, Zap, CircleDashed } from 'lucide-react';
import { countdowns, sampleAt } from '../lib/countdown.ts';
import { buildCsv, download, type CsvRow } from '../lib/csv.ts';
import { earthPhrase, horizonAtAz, placeFor, sunPhrase } from '../lib/places.ts';
import { METRIC_BY_NAME, METRICS, STATIC_METRICS, metricLabel, fmtMetric } from '../query/metrics.ts';
import { MAX_COMPARE, flyTo, select, seriesStep, toast, useStore, windowOf, type InspectorTab } from '../store.ts';
import { EllipsePanel } from './EllipsePanel.tsx';
import { HorizonPlot, needsFullScale } from './HorizonPlot.tsx';
import { PowerPanel } from './PowerPanel.tsx';
import { TraversePanel } from './TraversePanel.tsx';
import { Button, Dot, IconButton, Popover, Segmented, Tabs, Tag, Tooltip, Why } from './ui.tsx';
import { COMPARE_TIP, toggleTimeline, useCurrentRanks } from './LeftPanel.tsx';

/** Same export as the top bar: timeline + metrics of the inspected site (and the compare list) as CSV. */
function exportCsv() {
  const s = useStore.getState();
  const rows: CsvRow[] = [];
  const ids = [...(s.selected ? [s.selected] : []), ...s.compare.filter((c) => c !== s.selected)];
  for (const id of ids) {
    const t = s.targets[id], d = s.data[id];
    if (t && d?.vis) rows.push({ id, name: t.name, lat: t.lat, lon: t.lon, vis: d.vis, extra: { ...(t.metrics ?? {}), elev_m: d.horizon?.siteElevM } });
  }
  if (!rows.length) { toast('Wait for the site timeline to finish computing, then export.'); return; }
  const [a, b] = windowOf(s.query);
  download('lunar-navigator-export.csv', buildCsv(rows, `${new Date(a * 1000).toISOString()} to ${new Date(b * 1000).toISOString()}`));
}

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Sunlight', keys: ['sun_hours', 'sun_frac', 'longest_sun_h', 'longest_dark_h', 'mean_sun_el_deg', 'min_sun_el_deg', 'sun_disc_frac_mean', 'eclipse_hours'] },
  { title: 'Earth view and comms', keys: ['earth_hours', 'longest_earth_h', 'longest_no_earth_h', 'comms_hours', 'longest_comms_h', 'marginal_hours'] },
  { title: 'Sun and Earth together', keys: ['both_hours', 'longest_both_h'] },
  { title: 'Terrain', keys: STATIC_METRICS },
];

function MetricRow({ k, v, edu }: { k: string; v: number | undefined; edu: boolean }) {
  const def = METRIC_BY_NAME[k];
  const ok = v !== undefined && !Number.isNaN(v);
  const days = ok && def?.unit === 'h' && Math.abs(v!) >= 48 ? `${(v! / 24).toFixed(1)} d` : '';
  return (
    <tr>
      <th title={def?.plain}>{metricLabel(k, edu)}</th>
      <td className="mono">{ok ? v!.toFixed(def?.digits ?? 1) : '—'}</td>
      <td className="pn-unit">{ok ? (def?.unit ?? '') : ''}</td>
      <td className="pn-days mono">{days}</td>
    </tr>
  );
}

function DataTab({ m, edu }: { m: Record<string, number | undefined>; edu: boolean }) {
  const query = useStore((s) => s.query);
  const info = useStore((s) => s.info);
  const known = new Set(GROUPS.flatMap((g) => g.keys));
  const extra = METRICS.filter((x) => x.kind === 'window' && !x.needsPower && !known.has(x.name)).map((x) => x.name);
  const groups = extra.length ? [...GROUPS.slice(0, 3), { title: 'Other', keys: extra }, GROUPS[3]] : GROUPS;
  return (
    <div className="pn-pane">
      <p className="pn-sub">Window {query.window.start.slice(0, 10)} {'→'} {query.window.end.slice(0, 10)}</p>
      <table className="pn-table pn-data">
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.title} title={g.title}>{g.keys.filter((k) => !METRIC_BY_NAME[k]?.needsPower).map((k) => <MetricRow key={k} k={k} v={m[k]} edu={edu} />)}</GroupRows>
          ))}
        </tbody>
      </table>
      <p className="pn-hint">{info?.dsn === false ? 'DSN table not loaded: comms hours count Earth in view only. ' : ''}{query.relay ? 'Relay orbiter assumed: comms cover the whole window. ' : 'Comms = Earth in view and a Deep Space Network dish can see the Moon. '}Sun up = at least half the disc above the skyline. {edu && 'Eclipses are Earth passing in front of the Sun.'}<Why id={['both-up', 'eclipse']} /></p>
    </div>
  );
}
const GroupRows = ({ title, children }: { title: string; children: ReactNode }) => (
  <>
    <tr className="pn-grp"><th colSpan={4}>{title}</th></tr>
    {children}
  </>
);

export function Drawer({ allowCollapse = true }: { allowCollapse?: boolean }) {
  const id = useStore((s) => s.selected);
  const t = useStore((s) => (s.selected ? s.targets[s.selected] : undefined));
  const d = useStore((s) => (s.selected ? s.data[s.selected] : undefined));
  const sites = useStore((s) => s.sites);
  const cursor = useStore((s) => s.cursor);
  const query = useStore((s) => s.query);
  const edu = useStore((s) => s.educator);
  const model = useStore((s) => s.results?.model);
  const mode = useStore((s) => s.info?.mode);
  const inCompare = useStore((s) => (s.selected ? s.compare.includes(s.selected) : false));
  const ranks = useCurrentRanks();
  const full = useStore((s) => s.compare.length >= MAX_COMPARE);
  const tab = useStore((s) => s.inspectorTab);
  const collapsed = useStore((s) => s.rightCollapsed) && allowCollapse;
  const [pmode, setPmode] = useState<'polar' | 'panorama'>('polar');
  const [zoomPref, setZoom] = useState(true);
  const [ellOpen, setEllOpen] = useState(false);
  const win = useMemo(() => windowOf(query), [query]);
  const place = useMemo(() => (t && t.kind === 'result' ? placeFor(t.lat, t.lon, sites) : null), [t, sites]);
  if (!id || !t) return null;
  const now = sampleAt(d?.vis, cursor);
  const cd = countdowns(d?.vis, cursor, win[1]);
  // surface-charging note: only when a sunrise or sunset at the site is within 24 h of the cursor
  const edge = d?.vis?.events.filter((e) => (e.kind === 'sunset' || e.kind === 'sunrise') && Math.abs(e.t - cursor) <= 86400).sort((a, b) => Math.abs(a.t - cursor) - Math.abs(b.t - cursor))[0];
  const fullScale = needsFullScale(d?.vis);
  const zoom = zoomPref && !fullScale;
  const m = { ...(t.metrics ?? {}), ...(d?.vis?.metrics ?? {}) } as Record<string, number | undefined>;
  if (d?.horizon && m.elev_m === undefined) m.elev_m = d.horizon.siteElevM;
  const demo = mode === 'mock' || (t.kind === 'result' && model === 'mock');
  const name = place?.title ?? t.name;
  const curRank = ranks.get(id);
  const stale = t.kind === 'result' && curRank === undefined;
  // the selected site is always shown as a timeline row; the button pins it so it stays when another site is selected
  const selOnTimeline = true;
  const winH = (win[1] - win[0]) / 3600;
  const step = seriesStep(query);
  const refined = !!t.coarse && !!d?.vis;
  const hasRel = !!now && !!d?.horizon;
  const earthRel = now && d?.horizon ? now.earthEl - horizonAtAz(d.horizon.elevDeg, now.earthAz) : now?.earthEl ?? 0;
  const setTab = (k: InspectorTab) => useStore.setState({ inspectorTab: k });
  if (collapsed) {
    return (
      <aside className="drawer pn-drawer pn-rail" aria-label="Site details (collapsed)" data-tour="inspector">
        <IconButton icon={PanelRightOpen} label="Expand the site inspector ( ] )" tip="left" onClick={() => useStore.setState({ rightCollapsed: false })} />
      </aside>
    );
  }
  return (
    <aside className="drawer pn-drawer" aria-label="Site details" data-tour="inspector">
      <div className="pn-scroll">
        <header className="pn-dh">
          <div className="pn-dh-main">
            <h2>{curRank ? <span className={`pn-rank ${curRank === 1 ? 'is-gold' : ''}`}>{curRank}</span> : null}<span>{name}</span></h2>
            <p className="mono">{t.lat.toFixed(4)}{'°'}, {t.lon.toFixed(4)}{'°'}</p>
            {(place?.fromLabel || t.group) && <p className="pn-dh-sub">{place?.fromLabel || t.group}</p>}
          </div>
          <span className="pn-dh-btns">
            {allowCollapse && <IconButton className="pn-collapse" icon={ChevronRight} label="Collapse the inspector ( ] )" tip="bottom" onClick={() => useStore.setState({ rightCollapsed: true })} />}
            <IconButton icon={X} label="Close inspector" tip="left" onClick={() => select(null)} />
          </span>
        </header>
        <div className="pn-tags">
          {stale && <Tag tone="info" title="This point came from an earlier ranking; it is not in the current results, so it has no rank">From previous search</Tag>}
          {t.representative && <Tag tone="warn" title="One point stands in for a whole candidate region">Representative point</Tag>}
          {t.coarse && <Tag tone="warn" title="This cell was found on the global 10 km screening grid (coarse terrain, 6-hour steps). The timeline and metrics below are recomputed at 15 minutes with the local horizon, but treat the site as a lead, not a landing-site answer.">Coarse 10 km screening</Tag>}
          <Tag title="Horizon sampling resolution">{d?.horizon?.resolutionM ?? 20} m horizon</Tag>
          <Tag tone={demo ? 'info' : undefined} title={demo ? 'Synthetic demo terrain, not LOLA' : 'LOLA terrain model'}>{demo ? 'Demo terrain' : 'LOLA terrain'}</Tag>
          {d?.horizon && d.horizon.missingSamples > 0 && <Tag tone="warn">Gaps in terrain</Tag>}
        </div>

        {d?.vis && (['sun_hours', 'earth_hours', 'both_hours'] as const).some((k) => m[k] !== undefined) && (
          <section aria-label="Totals over the query window">
            <div className="pn-stats pn-stats--hero">
              {([['sun_hours', 'Sun', 'sun'], ['earth_hours', 'Earth', 'earth'], ['both_hours', 'Sun + Earth', 'ok']] as const).map(([k, label, tone]) => {
                const v = m[k];
                if (v === undefined) return <div key={k} className={`ui-stat ui-stat--${tone}`}><span className="ui-stat-label">{label}</span><span className="ui-stat-value">{'—'}</span></div>;
                const big = v >= 48;
                return (
                  <div key={k} className={`ui-stat ui-stat--${tone}`} title={`${metricLabel(k, edu)} over the window`}>
                    <span className="ui-stat-label">{label}</span>
                    <span className="ui-stat-value">{big ? (v / 24).toFixed(1) : Math.round(v)}<small>{big ? 'd' : 'h'}</small></span>
                    <span className="pn-stat-cap">{winH > 0 ? Math.min(100, Math.round((100 * v) / winH)) : 0}% of window</span>
                  </div>
                );
              })}
            </div>
            {refined && <p className="pn-hero-note">Recomputed at {step === 900 ? '15 min' : `${Math.round(step / 60)} min`} with the local horizon. The ranked card shows the coarse 10 km estimate (≈), so the numbers differ.</p>}
          </section>
        )}

        <section className="pn-now" aria-live="polite" aria-label="Now">
          <h3 className="ui-section-title">Now at the timeline cursor</h3>
          {cd ? (
            <>
              <div className={`pn-cd pn-cd--sun ${cd.sunSoon ? 'is-soon' : ''}`}><span className="pn-cd-ic"><Dot tone="sun" /></span><span>{cd.sun}</span></div>
              <div className={`pn-cd pn-cd--earth ${cd.earthSoon ? 'is-soon' : ''}`}><span className="pn-cd-ic"><Dot tone="earth" /></span><span>{cd.earth}</span></div>
            </>
          ) : <p className="pn-muted">{d?.error ? 'No terrain data at this location yet' : d?.loading ? 'Computing…' : 'No data'}</p>}
          {now && (
            <div className="pn-elaz mono">
              <span><i className="ui-dot ui-dot--sun" />{sunPhrase(now.sunEl, now.sunUp)}{now.sunUp ? ` el · ${now.sunAz.toFixed(0)}° az` : ''}</span>
              <span><i className="ui-dot ui-dot--earth" />{earthPhrase(now.earthEl, hasRel ? earthRel : now.earthEl, now.earthUp)}</span>
              <Why id="libration" />
            </div>
          )}
          {edge && <Tag tone="info" icon={Zap} title="Surface charging is stronger close to the day/night boundary">{edge.kind === 'sunset' ? 'Sunset' : 'Sunrise'} within a day: expect surface charging near the terminator.<Why id="charging" /></Tag>}
        </section>

        <div className="pn-actions">
          <Button variant="primary" icon={Eye} data-tour="stand" onClick={() => useStore.setState({ fpOpen: true })} disabled={!d?.horizon} title="First-person view from 2 m above the ground">Stand here</Button>
          <Button icon={Crosshair} onClick={() => flyTo(id)}>Fly to</Button>
          <Tooltip side="bottom" wrap content={inCompare ? 'On timeline. Click to remove this site from the timeline comparison' : selOnTimeline && !full ? 'Already shown on the timeline while selected. Click to keep it there when you select another site.' : full ? `Timeline is full (${MAX_COMPARE} sites). Remove one first.` : COMPARE_TIP}>
            <Button icon={selOnTimeline ? Check : Plus} active={selOnTimeline} disabled={!inCompare && full} onClick={() => toggleTimeline(id)}>{selOnTimeline ? 'On timeline' : 'Add to timeline'}</Button>
          </Tooltip>
          <Popover className="pn-more" trigger={(open, toggle) => <IconButton icon={Ellipsis} label="More actions" tip="bottom" active={open} onClick={toggle} />}>
            <button className="pn-menu-i" data-close-popover onClick={() => { setEllOpen(!ellOpen); }}><CircleDashed aria-hidden />{ellOpen ? 'Hide landing ellipse' : 'Landing ellipse'}</button>
            <button className="pn-menu-i" data-close-popover onClick={exportCsv}><Download aria-hidden />Export CSV</button>
          </Popover>
        </div>
        {ellOpen && <EllipsePanel target={t} />}

        <Tabs className="pn-dtabs" active={tab} onChange={setTab} tabs={[
          { id: 'sky', label: 'Sky', icon: Sunrise },
          { id: 'power', label: 'Power', icon: Zap },
          { id: 'traverse', label: 'Traverse', icon: Route },
          { id: 'data', label: 'Data', icon: Table2 },
        ]} />
        {tab === 'sky' && (
          <div className="pn-pane" data-tour="sky">
            <div className="pn-pane-h">
              <h3 className="ui-section-title">{edu ? 'Skyline' : 'Horizon'}<Why id={['horizon-plot', 'why-pole-hard', 'sun-skims-horizon']} /></h3>
              <Segmented label="Plot type" value={pmode} onChange={setPmode} options={[{ value: 'polar', label: 'Polar' }, { value: 'panorama', label: 'Panorama' }]} />
            </div>
            {d?.horizon ? <HorizonPlot horizon={d.horizon.elevDeg} vis={d.vis} now={now} mode={pmode} zoom={zoom} /> : <div className="pn-plot-skel ui-skel">Loading horizon{'…'}</div>}
            <div className="pn-plot-foot">
              <span className="pn-keys"><span><Dot tone="sun" />Sun track</span><span><Dot tone="earth" />Earth track</span><span><Mountain aria-hidden />Skyline</span></span>
              {pmode === 'polar' && (fullScale
                ? <span className="pn-hero-note" title="The Sun climbs high at this site, so the full 0–90° scale is used">Full 0{'–'}90{'°'} scale</span>
                : <label className="pn-check"><input type="checkbox" checked={zoom} onChange={(e) => setZoom(e.target.checked)} />Zoom 0{'–'}25{'°'}</label>)}
            </div>
            <p className="pn-hint">Large dots show the Sun and Earth at the timeline cursor. A track dipping behind the grey skyline means that body is hidden by terrain.</p>
          </div>
        )}
        {tab === 'power' && <PowerPanel target={t} />}
        {tab === 'traverse' && <TraversePanel target={t} />}
        {tab === 'data' && <DataTab m={m} edu={edu} />}
      </div>
    </aside>
  );
}
