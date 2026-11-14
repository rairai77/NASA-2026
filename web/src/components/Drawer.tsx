import { useMemo, useState, type ReactNode } from 'react';
import { Check, Crosshair, Download, Ellipsis, Eye, Mountain, Plus, Route, Sunrise, Table2, X, Zap, CircleDashed } from 'lucide-react';
import { countdowns, sampleAt } from '../lib/countdown.ts';
import { buildCsv, download, type CsvRow } from '../lib/csv.ts';
import { placeFor } from '../lib/places.ts';
import { METRIC_BY_NAME, METRICS, STATIC_METRICS, metricLabel, fmtMetric } from '../query/metrics.ts';
import { MAX_COMPARE, flyTo, select, toast, toggleCompare, useStore, windowOf, type InspectorTab } from '../store.ts';
import { EllipsePanel } from './EllipsePanel.tsx';
import { HorizonPlot } from './HorizonPlot.tsx';
import { PowerPanel } from './PowerPanel.tsx';
import { TraversePanel } from './TraversePanel.tsx';
import { Button, Dot, IconButton, Popover, Segmented, Tabs, Tag, Why } from './ui.tsx';

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
      <p className="pn-hint">{info?.dsn === false ? 'DSN table not loaded: comms hours count Earth in view only. ' : ''}{query.relay ? 'Relay orbiter assumed: comms cover the whole window. ' : 'Comms = Earth in view and a Deep Space Network dish can see the Moon. '}Sun up = at least half the disc above the skyline. {edu && 'Eclipses are Earth passing in front of the Sun.'}<Why id="eclipse" /><Why id="both-up" /></p>
    </div>
  );
}
const GroupRows = ({ title, children }: { title: string; children: ReactNode }) => (
  <>
    <tr className="pn-grp"><th colSpan={4}>{title}</th></tr>
    {children}
  </>
);

export function Drawer() {
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
  const full = useStore((s) => s.compare.length >= MAX_COMPARE);
  const tab = useStore((s) => s.inspectorTab);
  const [pmode, setPmode] = useState<'polar' | 'panorama'>('polar');
  const [zoom, setZoom] = useState(true);
  const [ellOpen, setEllOpen] = useState(false);
  const win = useMemo(() => windowOf(query), [query]);
  const place = useMemo(() => (t && t.kind === 'result' ? placeFor(t.lat, t.lon, sites) : null), [t, sites]);
  if (!id || !t) return null;
  const now = sampleAt(d?.vis, cursor);
  const cd = countdowns(d?.vis, cursor, win[1]);
  const near = now ? now.sunEl > -2 && now.sunEl < 8 : false;
  const m = { ...(t.metrics ?? {}), ...(d?.vis?.metrics ?? {}) } as Record<string, number | undefined>;
  if (d?.horizon && m.elev_m === undefined) m.elev_m = d.horizon.siteElevM;
  const demo = mode === 'mock' || (t.kind === 'result' && model === 'mock');
  const name = place?.title ?? t.name;
  const setTab = (k: InspectorTab) => useStore.setState({ inspectorTab: k });
  return (
    <aside className="drawer pn-drawer" aria-label="Site details">
      <div className="pn-scroll">
        <header className="pn-dh">
          <div className="pn-dh-main">
            <h2>{t.rank ? <span className={`pn-rank ${t.rank === 1 ? 'is-gold' : ''}`}>{t.rank}</span> : null}<span>{name}</span></h2>
            <p className="mono">{t.lat.toFixed(4)}{'°'}, {t.lon.toFixed(4)}{'°'}</p>
            {(place?.distLabel || t.group) && <p className="pn-dh-sub">{place?.distLabel ? `${place.distLabel} from the catalog site` : t.group}</p>}
          </div>
          <IconButton icon={X} label="Close inspector" tip="left" onClick={() => select(null)} />
        </header>
        <div className="pn-tags">
          {t.representative && <Tag tone="warn" title="One point stands in for a whole candidate region">Representative point</Tag>}
          {t.coarse && <Tag tone="warn" title="This cell was found on the global 10 km screening grid (coarse terrain, 6-hour steps). The timeline and metrics below are recomputed at 15 minutes with the local horizon, but treat the site as a lead, not a landing-site answer.">Coarse 10 km screening</Tag>}
          <Tag title="Horizon sampling resolution">{d?.horizon?.resolutionM ?? 20} m horizon</Tag>
          <Tag tone={demo ? 'info' : undefined} title={demo ? 'Synthetic demo terrain, not LOLA' : 'LOLA terrain model'}>{demo ? 'Demo terrain' : 'LOLA terrain'}</Tag>
          {d?.horizon && d.horizon.missingSamples > 0 && <Tag tone="warn">Gaps in terrain</Tag>}
        </div>

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
              <span><i className="ui-dot ui-dot--sun" />Sun {now.sunEl.toFixed(1)}{'°'} el {'·'} {now.sunAz.toFixed(0)}{'°'} az</span>
              <span><i className="ui-dot ui-dot--earth" />Earth {now.earthEl.toFixed(1)}{'°'} el{now.earthUp ? '' : ' (hidden)'}</span>
              <Why id="libration" />
            </div>
          )}
          {near && <Tag tone="warn" icon={Zap} title="Surface charging is stronger close to the day/night boundary">Near day/night boundary: stronger surface charging<Why id="charging" /></Tag>}
        </section>

        <div className="pn-actions">
          <Button variant="primary" icon={Eye} onClick={() => useStore.setState({ fpOpen: true })} disabled={!d?.horizon} title="First-person view from 2 m above the ground">Stand here</Button>
          <Button icon={Crosshair} onClick={() => flyTo(id)}>Fly to</Button>
          <Button icon={inCompare ? Check : Plus} active={inCompare} disabled={!inCompare && full} onClick={() => toggleCompare(id)} title={inCompare ? 'Remove from the timeline' : full ? `Timeline is full (${MAX_COMPARE} sites)` : 'Add to the timeline'}>
            <span className="pn-hide-s">{inCompare ? 'On timeline' : 'Timeline'}</span>
          </Button>
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
          <div className="pn-pane">
            <div className="pn-pane-h">
              <h3 className="ui-section-title">{edu ? 'Skyline' : 'Horizon'}<Why id="horizon-plot" /><Why id="why-pole-hard" /><Why id="sun-skims-horizon" /></h3>
              <Segmented label="Plot type" value={pmode} onChange={setPmode} options={[{ value: 'polar', label: 'Polar' }, { value: 'panorama', label: 'Panorama' }]} />
            </div>
            {d?.horizon ? <HorizonPlot horizon={d.horizon.elevDeg} vis={d.vis} now={now} mode={pmode} zoom={zoom} /> : <div className="pn-plot-skel ui-skel">Loading horizon{'…'}</div>}
            <div className="pn-plot-foot">
              <span className="pn-keys"><span><Dot tone="sun" />Sun track</span><span><Dot tone="earth" />Earth track</span><span><Mountain aria-hidden />Skyline</span></span>
              {pmode === 'polar' && <label className="pn-check"><input type="checkbox" checked={zoom} onChange={(e) => setZoom(e.target.checked)} />Zoom 0{'–'}25{'°'}</label>}
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
