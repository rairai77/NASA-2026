import { useEffect, useRef, useState } from 'react';
import { metricLabel, fmtMetric, TABLE_METRICS, STATIC_METRICS, METRIC_BY_NAME } from '../query/metrics.ts';
import { parseWhen } from '../lib/time.ts';
import { saveScenario, slipLaunch, useStore, type Scenario } from '../store.ts';
import { drawRow } from './Timeline.tsx';

function Mini({ s }: { s: Scenario }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!, W = 280, H = 34, dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const a = s.vis.t[0], b = s.vis.t[s.vis.t.length - 1];
    drawRow(g, s.vis, (t) => ((t - a) / (b - a)) * W, a, b, W, 0);
  }, [s]);
  return <canvas ref={ref} style={{ width: 280, height: 34 }} className="spark" aria-label={`Scenario ${s.label} timeline`} />;
}

const days = (s: Scenario) => ((parseWhen(s.query.window.end) - parseWhen(s.query.window.start)) / 86400).toFixed(0);

export function DiffTab() {
  const A = useStore((s) => s.scenA);
  const B = useStore((s) => s.scenB);
  const edu = useStore((s) => s.educator);
  const [weeks, setWeeks] = useState(4);
  const keys = [...TABLE_METRICS, ...STATIC_METRICS];
  const rows = A && B ? keys.map((k) => ({ k, a: A.metrics[k], b: B.metrics[k] })).filter((r) => r.a !== undefined && r.b !== undefined) : [];
  const chips = rows
    .map((r) => ({ ...r, d: (r.b as number) - (r.a as number) }))
    .filter((r) => TABLE_METRICS.includes(r.k) && Math.abs(r.d) > 0.5 * Math.pow(10, -(METRIC_BY_NAME[r.k]?.digits ?? 0)))
    .sort((x, y) => Math.abs(y.d) / (Math.abs(y.a as number) + 1) - Math.abs(x.d) / (Math.abs(x.a as number) + 1))
    .slice(0, 5);
  return (
    <div className="tab-body">
      <p className="hint">Save the current scenario (query + selected site + window) as A or B, then compare.</p>
      <div className="row"><button className="btn sm" onClick={() => saveScenario('A')}>Save as A</button><button className="btn sm" onClick={() => saveScenario('B')}>Save as B</button></div>
      <div className="slip">
        <span>Launch slipped by</span>
        <input className="num" type="number" min={-52} max={52} value={weeks} onChange={(e) => setWeeks(parseInt(e.target.value) || 0)} aria-label="weeks" style={{ width: 54 }} />
        <span>weeks</span>
        <button className="btn sm primary" onClick={() => slipLaunch(weeks)} title="Pins the current result as A, shifts the window, re-ranks and saves B">Apply</button>
      </div>
      {[A, B].map((s, i) => (
        <div key={i} className="scen">
          <b>{i === 0 ? 'A' : 'B'}{s ? `: ${s.target.name}` : ': (empty)'}</b>
          {s && <><small>{s.query.window.start.slice(0, 10)} {'→'} {s.query.window.end.slice(0, 10)} ({days(s)} d)</small><Mini s={s} /></>}
        </div>
      ))}
      {A && B && (
        <>
          <div className="diffchips">
            {chips.length === 0 && <span className="hint">No notable differences.</span>}
            {chips.map((c) => (
              <span key={c.k} className={`dchip ${c.d > 0 ? 'up' : 'down'}`}>{metricLabel(c.k, edu)} {c.d > 0 ? '+' : '−'}{fmtMetric(c.k, Math.abs(c.d)).replace(/ \(.*\)/, '')}</span>
            ))}
          </div>
          <table className="mtable diff">
            <thead><tr><th /><th>A</th><th>B</th><th>{'Δ'}</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const d = (r.b as number) - (r.a as number);
                const tiny = Math.abs(d) < 0.5 * Math.pow(10, -(METRIC_BY_NAME[r.k]?.digits ?? 0));
                return (
                  <tr key={r.k}>
                    <th>{metricLabel(r.k, edu)}</th>
                    <td>{fmtMetric(r.k, r.a).replace(/ \(.*\)/, '')}</td>
                    <td>{fmtMetric(r.k, r.b).replace(/ \(.*\)/, '')}</td>
                    <td className={tiny ? '' : d > 0 ? 'dup' : 'ddown'}>{tiny ? '=' : `${d > 0 ? '▲ +' : '▼ −'}${fmtMetric(r.k, Math.abs(d)).replace(/ \(.*\)/, '')}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint">{'▲'} blue = B higher than A, {'▼'} orange = B lower. Higher is not always better (e.g. longest dark run).</p>
        </>
      )}
    </div>
  );
}
