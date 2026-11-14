import { useMemo, useState } from 'react';
import { countdowns, sampleAt } from '../lib/countdown.ts';
import { fmtMetric, metricLabel, STATIC_METRICS, TABLE_METRICS } from '../query/metrics.ts';
import { flyTo, select, toggleCompare, useStore, windowOf } from '../store.ts';
import { EllipsePanel } from './EllipsePanel.tsx';
import { HorizonPlot } from './HorizonPlot.tsx';
import { Badge, Why } from './ui.tsx';

export function Drawer() {
  const id = useStore((s) => s.selected);
  const t = useStore((s) => (s.selected ? s.targets[s.selected] : undefined));
  const d = useStore((s) => (s.selected ? s.data[s.selected] : undefined));
  const cursor = useStore((s) => s.cursor);
  const query = useStore((s) => s.query);
  const edu = useStore((s) => s.educator);
  const model = useStore((s) => s.results?.model);
  const mode = useStore((s) => s.info?.mode);
  const inCompare = useStore((s) => (s.selected ? s.compare.includes(s.selected) : false));
  const [pmode, setPmode] = useState<'polar' | 'panorama'>('polar');
  const [zoom, setZoom] = useState(true);
  const [ellOpen, setEllOpen] = useState(false);
  const win = useMemo(() => windowOf(query), [query]);
  if (!id || !t) return null;
  const now = sampleAt(d?.vis, cursor);
  const cd = countdowns(d?.vis, cursor, win[1]);
  const near = now ? now.sunEl > -2 && now.sunEl < 8 : false;
  const m = { ...(t.metrics ?? {}), ...(d?.vis?.metrics ?? {}) } as Record<string, number | undefined>;
  if (d?.horizon && m.elev_m === undefined) m.elev_m = d.horizon.siteElevM;
  const demo = mode === 'mock' || (t.kind === 'result' && model === 'mock');
  return (
    <aside className="drawer" aria-label="Site details">
      <header>
        <div>
          <h2>{t.rank ? <span className="rank sm">{t.rank}</span> : null}{t.name}</h2>
          <p className="coords">{t.lat.toFixed(4)}{'°'}, {t.lon.toFixed(4)}{'°'} <span>{t.group ?? (t.kind === 'result' ? 'ranked cell' : '')}</span></p>
        </div>
        <button className="icon-btn" aria-label="Close" onClick={() => select(null)}>{'×'}</button>
      </header>
      <div className="badges">
        {t.representative && <Badge tone="warn" title="One point stands in for a whole candidate region">representative point</Badge>}
        <Badge title="Horizon sampling resolution">resolution {d?.horizon?.resolutionM ?? 20} m</Badge>
        <Badge tone={demo ? 'demo' : ''} title={demo ? 'Synthetic demo terrain, not LOLA' : 'LOLA terrain model'}>{demo ? 'demo terrain model' : 'terrain model'}</Badge>
        {d?.horizon && d.horizon.missingSamples > 0 && <Badge tone="warn">gaps in terrain</Badge>}
      </div>

      <div className="countdowns" aria-live="polite">
        {cd ? (
          <>
            <div className={`cd sun ${cd.sunSoon ? 'soon' : ''}`}><i />{cd.sun}</div>
            <div className={`cd earth ${cd.earthSoon ? 'soon' : ''}`}><i />{cd.earth}</div>
          </>
        ) : <div className="cd muted">{d?.error ? 'No terrain data at this location yet' : d?.loading ? 'Computing…' : 'No data'}</div>}
        {now && <small className="now">Sun {now.sunEl.toFixed(1)}{'°'} el, {now.sunAz.toFixed(0)}{'°'} az {'·'} Earth {now.earthEl.toFixed(1)}{'°'} el{now.earthUp ? '' : ' (hidden)'}<Why id="libration" /></small>}
        {near && <div className="charge" title="Surface charging is stronger close to the day/night boundary">{'⚡'} Near day/night boundary: stronger surface charging<Why id="charging" /></div>}
      </div>

      <section>
        <div className="sec-h">
          <h3>{edu ? 'Skyline' : 'Horizon'}<Why id="pole" /></h3>
          <div className="seg" role="group">
            <button className={pmode === 'polar' ? 'on' : ''} onClick={() => setPmode('polar')}>Polar</button>
            <button className={pmode === 'panorama' ? 'on' : ''} onClick={() => setPmode('panorama')}>Panorama</button>
          </div>
        </div>
        {d?.horizon ? <HorizonPlot horizon={d.horizon.elevDeg} vis={d.vis} now={now} mode={pmode} zoom={zoom} /> : <div className="plot-skel">Loading horizon{'…'}</div>}
        <div className="plot-foot">
          <span className="legend"><i style={{ background: '#F5B700' }} />Sun track <i style={{ background: '#4FA3FF' }} />Earth track</span>
          {pmode === 'polar' && <label className="check"><input type="checkbox" checked={zoom} onChange={(e) => setZoom(e.target.checked)} />zoom to 0{'–'}25{'°'}</label>}
        </div>
      </section>

      <div className="actions">
        <button className="btn primary" onClick={() => useStore.setState({ fpOpen: true })} disabled={!d?.horizon}>Stand here</button>
        <button className="btn" onClick={() => setEllOpen(!ellOpen)} aria-expanded={ellOpen}>Landing ellipse</button>
        <button className="btn" onClick={() => toggleCompare(id)}>{inCompare ? 'Remove from compare' : 'Add to compare'}</button>
        <button className="btn ghost" onClick={() => flyTo(id)}>Fly to</button>
      </div>
      {ellOpen && <EllipsePanel target={t} />}

      <section>
        <h3>Metrics for window <small>{query.window.start.slice(0, 10)} {'→'} {query.window.end.slice(0, 10)}</small></h3>
        <table className="mtable">
          <tbody>
            {TABLE_METRICS.map((k) => <tr key={k}><th>{metricLabel(k, edu)}</th><td>{fmtMetric(k, m[k])}</td></tr>)}
            <tr className="sep"><th colSpan={2}>Terrain</th></tr>
            {STATIC_METRICS.map((k) => <tr key={k}><th>{metricLabel(k, edu)}</th><td>{fmtMetric(k, m[k])}</td></tr>)}
          </tbody>
        </table>
        <p className="hint">Sun up = at least half the disc above the skyline. {edu && 'Eclipses are Earth passing in front of the Sun.'}<Why id="eclipse" /></p>
      </section>
    </aside>
  );
}
