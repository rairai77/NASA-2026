import { useEffect, useMemo, useState } from 'react';
import * as d3 from 'd3';
import type { EllipseResult } from '../engine/api.ts';
import { getEngine } from '../engine/client.ts';
import { fmtMetric, metricLabel } from '../query/metrics.ts';
import { useStore, windowOf, type Target } from '../store.ts';
import { MetricSelectAll } from './MetricSelectAll.tsx';
import { NumInput } from './ui.tsx';

const SUMMARY = ['sun_hours', 'longest_dark_h', 'earth_hours', 'longest_both_h', 'slope_deg'];

export function EllipsePanel({ target }: { target: Target }) {
  const query = useStore((s) => s.query);
  const edu = useStore((s) => s.educator);
  const [a, setA] = useState(300), [b, setB] = useState(150), [rot, setRot] = useState(0), [n, setN] = useState(100);
  const [res, setRes] = useState<EllipseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [metric, setMetric] = useState('sun_hours');
  const [err, setErr] = useState('');
  useEffect(() => { setRes(null); useStore.setState({ ellipseDraw: null }); }, [target.id]);
  useEffect(() => () => useStore.setState({ ellipseDraw: null }), []);

  const run = async () => {
    setBusy(true); setErr('');
    try {
      const [t0, t1] = windowOf(query);
      const r = await getEngine().ellipse({ lat: target.lat, lon: target.lon, semiMajorM: a, semiMinorM: b, rotDeg: rot, n: Math.round(n), heightM: query.height_m, tStart: t0, tEnd: t1 });
      setRes(r);
      useStore.setState({ ellipseDraw: { lat: target.lat, lon: target.lon, a, b, rot } });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="ellipse">
      <h3>Landing ellipse <small>worst / median / best over {Math.round(n)} points</small></h3>
      <div className="grid4">
        <label>Semi-major (m)<NumInput value={a} min={10} max={5000} width={64} onChange={setA} /></label>
        <label>Semi-minor (m)<NumInput value={b} min={10} max={5000} width={64} onChange={setB} /></label>
        <label>Rotation ({'°'} from N)<NumInput value={rot} min={0} max={180} width={64} onChange={setRot} /></label>
        <label>Points (n)<NumInput value={n} min={10} max={400} width={64} onChange={setN} /></label>
      </div>
      <button className="btn primary" onClick={run} disabled={busy}>{busy ? 'Computing…' : 'Run ellipse'}</button>
      {err && <p className="err">{err}</p>}
      {res && (
        <>
          <table className="mtable ell">
            <thead><tr><th /><th>min</th><th>median</th><th>max</th></tr></thead>
            <tbody>
              {SUMMARY.map((k) => res.summary[k] && (
                <tr key={k}><th>{metricLabel(k, edu)}</th>{(['min', 'median', 'max'] as const).map((c) => <td key={c}>{fmtMetric(k, res.summary[k][c]).replace(/ \(.*\)/, '')}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <div className="sec-h"><h3>Per-point map</h3><MetricSelectAll value={metric} onChange={setMetric} keys={SUMMARY} /></div>
          <Scatter res={res} metric={metric} lat={target.lat} lon={target.lon} />
        </>
      )}
    </section>
  );
}

function Scatter({ res, metric, lat, lon }: { res: EllipseResult; metric: string; lat: number; lon: number }) {
  const S = 220, pad = 14;
  const pts = useMemo(() => {
    const R = 1737400, D2R = Math.PI / 180;
    return res.points.map((p) => ({
      e: (p.lon - lon) * D2R * R * Math.cos(lat * D2R), n: (p.lat - lat) * D2R * R, v: p.metrics[metric] ?? 0,
    }));
  }, [res, metric, lat, lon]);
  const ext = Math.max(1, ...pts.map((p) => Math.max(Math.abs(p.e), Math.abs(p.n))));
  const sc = d3.scaleLinear().domain([-ext, ext]).range([pad, S - pad]);
  const vals = pts.map((p) => p.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const col = d3.scaleSequential(d3.interpolateViridis).domain([lo, hi === lo ? lo + 1 : hi]);
  return (
    <div className="scatter">
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Per-point ${metric} within the landing ellipse`}>
        <rect x={0} y={0} width={S} height={S} fill="#05070c" />
        <line x1={sc(0)} x2={sc(0)} y1={pad} y2={S - pad} stroke="#1f2837" /><line y1={sc(0)} y2={sc(0)} x1={pad} x2={S - pad} stroke="#1f2837" />
        <text x={S / 2} y={10} textAnchor="middle" className="ptxt">N</text>
        {pts.map((p, i) => <circle key={i} cx={sc(p.e)} cy={S - sc(p.n)} r={4} fill={col(p.v)} />)}
      </svg>
      <div className="cbar"><span>{fmtMetric(metric, lo).replace(/ \(.*\)/, '')}</span><i style={{ background: 'linear-gradient(90deg,#440154,#3b528b,#21918c,#5ec962,#fde725)' }} /><span>{fmtMetric(metric, hi).replace(/ \(.*\)/, '')}</span></div>
      <p className="hint">Extent {'±'}{Math.round(ext)} m. Colour is not red/green; viridis is colour-blind safe.</p>
    </div>
  );
}
