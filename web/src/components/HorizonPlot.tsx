import { useMemo } from 'react';
import * as d3 from 'd3';
import type { VisResult } from '../engine/api.ts';
import type { Sample } from '../lib/countdown.ts';

const D2R = Math.PI / 180;

function interp(h: Float32Array, az: number): number {
  const n = h.length;
  const f = (((az % 360) + 360) % 360) / 360 * n;
  const i = Math.floor(f);
  return h[i % n] * (1 - (f - i)) + h[(i + 1) % n] * (f - i);
}

/** True when the Sun climbs well above the zoomed 0-25 deg scale (low-latitude sites): use the full 0-90 deg scale. */
export function needsFullScale(v: VisResult | undefined): boolean {
  if (!v) return false;
  let mx = -90;
  for (let i = 0; i < v.sunEl.length; i++) if (v.sunEl[i] > mx) mx = v.sunEl[i];
  return mx > 20;
}

interface Props { horizon: Float32Array; vis?: VisResult; now: Sample | null; mode: 'polar' | 'panorama'; zoom: boolean }

function trackPoints(v: VisResult | undefined, which: 'sun' | 'earth', elMin: number) {
  if (!v) return [] as { az: number; el: number }[][];
  const n = v.t.length;
  const stride = Math.max(1, Math.ceil(n / 900));
  const az = which === 'sun' ? v.sunAz : v.earthAz, el = which === 'sun' ? v.sunEl : v.earthEl;
  const segs: { az: number; el: number }[][] = [];
  let cur: { az: number; el: number }[] = [];
  let prev = -1;
  for (let i = 0; i < n; i += stride) {
    if (el[i] < elMin || (prev >= 0 && Math.abs(az[i] - prev) > 180)) { if (cur.length > 1) segs.push(cur); cur = []; }
    prev = az[i];
    if (el[i] >= elMin) cur.push({ az: az[i], el: el[i] });
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

export function HorizonPlot({ horizon, vis, now, mode, zoom }: Props) {
  const full = useMemo(() => needsFullScale(vis), [vis]);
  return mode === 'polar' ? <Polar horizon={horizon} vis={vis} now={now} zoom={zoom && !full} /> : <Panorama horizon={horizon} vis={vis} now={now} full={full} />;
}

function Polar({ horizon, vis, now, zoom }: { horizon: Float32Array; vis?: VisResult; now: Sample | null; zoom: boolean }) {
  const S = 300, C = S / 2, R = 128;
  const top = zoom ? 25 : 90, bot = -5;
  const rOf = (el: number) => (R * (top - Math.min(top, el))) / (top - bot);
  const pt = (az: number, el: number): [number, number] => [C + rOf(el) * Math.sin(az * D2R), C - rOf(el) * Math.cos(az * D2R)];
  const skyline = useMemo(() => {
    const n = 360;
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) pts.push([i * 360 / n, interp(horizon, i * 360 / n)] as [number, number]);
    return pts.map(([az, el]) => pt(az, Math.max(bot, el)));
  }, [horizon, zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  const line = d3.line();
  const skyPath = line(skyline) + 'Z';
  const outer = `M${C - R},${C}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0Z`;
  const rings = zoom ? [0, 10, 20] : [0, 30, 60];
  const sunSegs = useMemo(() => trackPoints(vis, 'sun', bot), [vis]);
  const earthSegs = useMemo(() => trackPoints(vis, 'earth', bot), [vis]);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="hplot" role="img" aria-label="Horizon polar plot with Sun and Earth tracks">
      <circle cx={C} cy={C} r={R} className="hp-bg hp-edge" />
      {rings.map((el) => <circle key={el} cx={C} cy={C} r={rOf(el)} fill="none" className="hp-grid" strokeDasharray={el === 0 ? '' : '2 3'} />)}
      {rings.map((el) => <text key={`t${el}`} x={C + 3} y={C - rOf(el) - 2} className="ptxt">{el}{'°'}</text>)}
      {[0, 90, 180, 270].map((az) => { const [x1, y1] = pt(az, top), [x2, y2] = pt(az, bot); return <line key={az} x1={x1} y1={y1} x2={x2} y2={y2} className="hp-grid" />; })}
      {sunSegs.map((s, i) => <path key={`s${i}`} d={line(s.map((p) => pt(p.az, p.el))) ?? ''} fill="none" style={{ stroke: 'var(--sun)' }} strokeWidth={1.6} opacity={0.9} />)}
      {earthSegs.map((s, i) => <path key={`e${i}`} d={line(s.map((p) => pt(p.az, p.el))) ?? ''} fill="none" style={{ stroke: 'var(--earth)' }} strokeWidth={1.6} opacity={0.95} />)}
      <path d={outer + skyPath} fillRule="evenodd" className="hp-terrain" />
      {now && now.earthEl > bot && <circle cx={pt(now.earthAz, now.earthEl)[0]} cy={pt(now.earthAz, now.earthEl)[1]} r={6} style={{ fill: 'var(--earth)' }} className="hp-dot" />}
      {now && now.sunEl > bot && <circle cx={pt(now.sunAz, now.sunEl)[0]} cy={pt(now.sunAz, now.sunEl)[1]} r={6} style={{ fill: 'var(--sun)' }} className="hp-dot" />}
      {(['N', 'E', 'S', 'W'] as const).map((l, i) => { const [x, y] = pt(i * 90, bot); const dx = Math.sin(i * 90 * D2R) * 11, dy = -Math.cos(i * 90 * D2R) * 11; return <text key={l} x={x + dx} y={y + dy + 4} textAnchor="middle" className="compass">{l}</text>; })}
    </svg>
  );
}

function Panorama({ horizon, vis, now, full }: { horizon: Float32Array; vis?: VisResult; now: Sample | null; full?: boolean }) {
  const W = 316, H = 170, m = { l: 28, r: 6, t: 8, b: 22 };
  const x = d3.scaleLinear().domain([0, 360]).range([m.l, W - m.r]);
  const TOP = full ? 90 : 15;
  const y = d3.scaleLinear().domain([-5, TOP]).range([H - m.b, m.t]);
  const area = useMemo(() => {
    const pts = Array.from({ length: 361 }, (_, i) => [i, interp(horizon, i)] as [number, number]);
    return d3.area<[number, number]>().x((d) => x(d[0])).y0(H - m.b).y1((d) => y(Math.min(TOP, Math.max(-5, d[1]))))(pts) ?? '';
  }, [horizon, TOP]); // eslint-disable-line react-hooks/exhaustive-deps
  const ridge = useMemo(() => d3.line<[number, number]>().x((d) => x(d[0])).y((d) => y(Math.min(TOP, Math.max(-5, d[1]))))(Array.from({ length: 361 }, (_, i) => [i, interp(horizon, i)] as [number, number])) ?? '', [horizon, TOP]); // eslint-disable-line react-hooks/exhaustive-deps
  const sunSegs = useMemo(() => trackPoints(vis, 'sun', -5), [vis]);
  const earthSegs = useMemo(() => trackPoints(vis, 'earth', -5), [vis]);
  const ln = d3.line<{ az: number; el: number }>().x((p) => x(p.az)).y((p) => y(Math.min(TOP + 0.5, p.el)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="hplot pano" role="img" aria-label="Horizon panorama with Sun and Earth tracks">
      <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} className="hp-bg" />
      {(full ? [0, 30, 60, 90] : [-5, 0, 5, 10, 15]).map((e) => <g key={e}><line x1={m.l} x2={W - m.r} y1={y(e)} y2={y(e)} className="hp-grid" strokeDasharray={e === 0 ? '' : '2 3'} /><text x={m.l - 4} y={y(e) + 3} textAnchor="end" className="ptxt">{e}{'°'}</text></g>)}
      {[0, 45, 90, 135, 180, 225, 270, 315, 360].map((a) => <g key={a}><line x1={x(a)} x2={x(a)} y1={m.t} y2={H - m.b} className="hp-grid" /><text x={x(a)} y={H - 7} textAnchor="middle" className={a % 90 === 0 ? 'compass' : 'ptxt'}>{({ 0: 'N', 90: 'E', 180: 'S', 270: 'W', 360: 'N' } as Record<number, string>)[a] ?? a}</text></g>)}
      {sunSegs.map((s, i) => <path key={`s${i}`} d={ln(s) ?? ''} fill="none" style={{ stroke: 'var(--sun)' }} strokeWidth={1.6} opacity={0.9} />)}
      {earthSegs.map((s, i) => <path key={`e${i}`} d={ln(s) ?? ''} fill="none" style={{ stroke: 'var(--earth)' }} strokeWidth={1.6} opacity={0.95} />)}
      <path d={area} className="hp-terrain hp-fill" />
      <path d={ridge} fill="none" className="hp-ridge" />
      {now && now.earthEl >= -5 && <circle cx={x(now.earthAz)} cy={y(Math.min(TOP, now.earthEl))} r={6} style={{ fill: 'var(--earth)' }} className="hp-dot" />}
      {now && now.sunEl >= -5 && <circle cx={x(now.sunAz)} cy={y(Math.min(TOP, now.sunEl))} r={6} style={{ fill: 'var(--sun)' }} className="hp-dot" />}
    </svg>
  );
}
