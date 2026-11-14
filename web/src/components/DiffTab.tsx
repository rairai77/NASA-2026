import { useState } from 'react';
import { ArrowDown, ArrowUp, FastForward, Save } from 'lucide-react';
import { metricLabel, fmtMetric, TABLE_METRICS, STATIC_METRICS, METRIC_BY_NAME } from '../query/metrics.ts';
import { parseWhen } from '../lib/time.ts';
import { saveScenario, slipLaunch, useStore, type Scenario } from '../store.ts';
import { placeFor } from '../lib/places.ts';
import { Button } from './ui.tsx';
import { LaneStrip } from './LaneStrip.tsx';

const days = (s: Scenario) => ((parseWhen(s.query.window.end) - parseWhen(s.query.window.start)) / 86400).toFixed(0);
const winOf = (s: Scenario): [number, number] => [parseWhen(s.query.window.start), parseWhen(s.query.window.end)];

function Slot({ label, s }: { label: 'A' | 'B'; s: Scenario | null }) {
  const sites = useStore((st) => st.sites);
  const name = s ? (s.target.kind === 'result' ? placeFor(s.target.lat, s.target.lon, sites).title : s.target.name) : 'Empty';
  return (
    <section className={`pn-slot ${s ? '' : 'is-empty'}`}>
      <header>
        <span className={`pn-chip pn-chip--${label}`}>{label}</span>
        <b>{name}</b>
      </header>
      {s ? (
        <>
          <small className="mono">{s.query.window.start.slice(0, 10)} {'→'} {s.query.window.end.slice(0, 10)} ({days(s)} d)</small>
          <LaneStrip vis={s.vis} win={winOf(s)} labels={false} label={`Scenario ${label} timeline`} />
        </>
      ) : <small>Nothing saved yet</small>}
      <Button size="sm" icon={Save} onClick={() => saveScenario(label)}>Save current as {label}</Button>
    </section>
  );
}

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
    <div className="pn-body">
      <div className="pn-head">
        <h2 className="pn-h">Compare dates</h2>
        <p className="pn-sub">Save the current date window as A, change the dates (e.g. a launch slip), save as B, and see what changes for this site.</p>
      </div>
      {!A && !B && (
        <ol className="pn-steps" aria-label="How it works">
          <li>Pick a site and save the current dates as <b>A</b>.</li>
          <li>Change the dates in the query bar, or use {'“'}What if the launch slips?{'”'} below.</li>
          <li>Save them as <b>B</b>. The biggest changes appear here.</li>
        </ol>
      )}
      <div className="pn-slots"><Slot label="A" s={A} /><Slot label="B" s={B} /></div>
      <section className="pn-slip">
        <h3 className="ui-section-title">What if the launch slips?</h3>
        <p className="pn-hint">Shortcut: saves the current dates as A, shifts them, and saves B for you.</p>
        <div className="pn-slip-row">
          <span>Slip by</span>
          <input className="num" type="number" min={-52} max={52} value={weeks} onChange={(e) => setWeeks(parseInt(e.target.value) || 0)} aria-label="weeks" />
          <span>weeks</span>
          <Button variant="primary" size="sm" icon={FastForward} onClick={() => slipLaunch(weeks)} title="Pins the current result as A, shifts the window, re-ranks and saves B">Apply</Button>
        </div>
      </section>
      {A && B && (
        <>
          <h3 className="ui-section-title">Biggest changes (B vs A)</h3>
          <div className="pn-dchips">
            {chips.length === 0 && <span className="pn-hint">No notable differences.</span>}
            {chips.map((c) => (
              <span key={c.k} className={`pn-dchip ${c.d > 0 ? 'up' : 'down'}`}>
                {c.d > 0 ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}{metricLabel(c.k, edu)} {c.d > 0 ? '+' : '−'}{fmtMetric(c.k, Math.abs(c.d)).replace(/ \(.*\)/, '')}
              </span>
            ))}
          </div>
          <table className="pn-table pn-diff">
            <thead><tr><th /><th><span className="pn-chip pn-chip--A">A</span></th><th><span className="pn-chip pn-chip--B">B</span></th><th>{'Δ'}</th></tr></thead>
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
          <p className="pn-hint">{'▲'} blue = B higher than A, {'▼'} orange = B lower. Higher is not always better (e.g. longest dark run).</p>
        </>
      )}
    </div>
  );
}
