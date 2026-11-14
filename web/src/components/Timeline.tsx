import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { VisResult } from '../engine/api.ts';
import { DAY, HOUR, clamp, fmtUTC } from '../lib/time.ts';
import { select, setCursor, toggleCompare, useActiveIds, useStore, windowOf } from '../store.ts';
import { COLORS } from './LeftPanel.tsx';
import { Why } from './ui.tsx';

const ROW_H = 34;
const AXIS_H = 24;
const LABEL_W = 176;
export const SPEEDS: [string, number][] = [['1 h/s', HOUR], ['6 h/s', 6 * HOUR], ['1 d/s', DAY]];

export function drawRow(g: CanvasRenderingContext2D, v: VisResult | undefined, x: (t: number) => number, v0: number, v1: number, W: number, y: number) {
  g.fillStyle = 'rgba(255,255,255,0.045)';
  g.fillRect(0, y + 2, W, 10); g.fillRect(0, y + 13, W, 10); g.fillRect(0, y + 24, W, 7);
  if (!v || v.t.length < 2) return;
  const n = v.t.length, step = v.t[1] - v.t[0];
  const t0 = v.t[0];
  const iA = clamp(Math.floor((v0 - t0) / step) - 1, 0, n - 1);
  const iB = clamp(Math.ceil((v1 - t0) / step) + 1, 0, n - 1);
  const pxPerStep = Math.abs(x(t0 + step) - x(t0));
  const cols = Math.ceil(W);
  const su = new Float32Array(cols), ea = new Float32Array(cols), bo = new Float32Array(cols), cnt = new Float32Array(cols), ec = new Uint8Array(cols);
  for (let i = iA; i <= iB; i++) {
    const px0 = x(v.t[i]);
    const px1 = px0 + pxPerStep;
    const a = Math.max(0, Math.floor(px0)), b = Math.min(cols - 1, Math.max(a, Math.ceil(px1) - 1));
    const s = v.sunFrac[i] >= 0.5 ? 1 : 0, e = v.earthUp[i], bb = s && e ? 1 : 0, ecl = v.eclipseFrac[i] > 0 && s ? 1 : 0;
    for (let c = a; c <= b; c++) { su[c] += s; ea[c] += e; bo[c] += bb; cnt[c]++; if (ecl) ec[c] = 1; }
  }
  for (let c = 0; c < cols; c++) {
    if (!cnt[c]) continue;
    g.globalAlpha = su[c] / cnt[c]; g.fillStyle = COLORS.sun; g.fillRect(c, y + 2, 1, 10);
    g.globalAlpha = ea[c] / cnt[c]; g.fillStyle = COLORS.earth; g.fillRect(c, y + 13, 1, 10);
    g.globalAlpha = bo[c] / cnt[c]; g.fillStyle = COLORS.both; g.fillRect(c, y + 24, 1, 7);
    if (ec[c]) { g.globalAlpha = 1; g.fillStyle = COLORS.eclipse; g.fillRect(c - 1, y, 3, 2); g.fillRect(c, y + 2, 1, 10); }
  }
  g.globalAlpha = 1;
}

function PlayControls() {
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const cursor = useStore((s) => s.cursor);
  return (
    <div className="tl-controls">
      <button className="btn play" onClick={() => useStore.setState({ playing: !playing })} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)">{playing ? '❚❚' : '▶'}</button>
      <div className="seg" role="group" aria-label="Playback speed">
        {SPEEDS.map(([l, v]) => <button key={l} className={speed === v ? 'on' : ''} onClick={() => useStore.setState({ speed: v })}>{l}</button>)}
      </div>
      <button className="btn sm" onClick={() => setCursor(cursor - HOUR)} aria-label="Back 1 hour" title="←">{'‹'} 1 h</button>
      <button className="btn sm" onClick={() => setCursor(cursor + HOUR)} aria-label="Forward 1 hour" title="→">1 h {'›'}</button>
      <span className="clock" aria-live="off">{fmtUTC(cursor)}</span>
      <span className="keys">{'←→'} 1 h {'·'} Shift 1 d {'·'} Space play</span>
    </div>
  );
}

export function Timeline() {
  const ids = useActiveIds();
  const targets = useStore((s) => s.targets);
  const data = useStore((s) => s.data);
  const selected = useStore((s) => s.selected);
  const view = useStore((s) => s.view);
  const query = useStore((s) => s.query);
  const cursor = useStore((s) => s.cursor);
  const markers = useStore((s) => s.markers);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [W, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  const win = useMemo(() => windowOf(query), [query]);
  const rows = Math.max(1, ids.length);
  const H = AXIS_H + rows * ROW_H;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(100, Math.floor(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(100, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  const xOf = useCallback((t: number) => ((t - view[0]) / (view[1] - view[0])) * W, [view, W]);
  const tOf = useCallback((px: number) => view[0] + (px / W) * (view[1] - view[0]), [view, W]);

  // draw bands + axis
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // axis
    const scale = d3.scaleUtc().domain([new Date(view[0] * 1000), new Date(view[1] * 1000)]).range([0, W]);
    const ticks = scale.ticks(Math.max(3, Math.floor(W / 110)));
    const fmt = scale.tickFormat(Math.max(3, Math.floor(W / 110)));
    g.font = '11px ui-sans-serif, system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.fillStyle = '#98a2b8';
    for (const tk of ticks) {
      const x = Math.round(scale(tk)) + 0.5;
      g.beginPath(); g.moveTo(x, AXIS_H - 6); g.lineTo(x, H); g.stroke();
      g.fillText(fmt(tk), x + 4, 10);
    }
    // window edges
    g.fillStyle = 'rgba(0,0,0,0.45)';
    const xa = xOf(win[0]), xb = xOf(win[1]);
    if (xa > 0) g.fillRect(0, AXIS_H, xa, H - AXIS_H);
    if (xb < W) g.fillRect(xb, AXIS_H, W - xb, H - AXIS_H);
    ids.forEach((id, i) => drawRow(g, data[id]?.vis, xOf, view[0], view[1], W, AXIS_H + i * ROW_H));
  }, [ids, data, view, W, H, win, xOf]);

  // wheel zoom / pan
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useStore.getState();
      const [v0, v1] = s.view;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        const dt = ((e.deltaX || e.deltaY) / rect.width) * (v1 - v0);
        panBy(dt);
        return;
      }
      const tc = v0 + (px / rect.width) * (v1 - v0);
      const f = Math.exp(e.deltaY * 0.0015);
      const [w0, w1] = windowOf(s.query);
      const span = clamp((v1 - v0) * f, 6 * HOUR, w1 - w0);
      let a = tc - (tc - v0) * (span / (v1 - v0));
      a = clamp(a, w0, w1 - span);
      useStore.setState({ view: [a, a + span] });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const drag = useRef<null | { mode: 'scrub' | 'pan'; x0: number; view0: [number, number]; moved: boolean }>(null);
  const localX = (e: React.PointerEvent) => e.clientX - wrapRef.current!.getBoundingClientRect().left;

  const onDown = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const y = e.clientY - rect.top, x = localX(e);
    const onCursor = Math.abs(x - xOf(cursor)) < 7;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (y < AXIS_H || onCursor) { drag.current = { mode: 'scrub', x0: x, view0: view, moved: true }; setCursor(tOf(x)); }
    else drag.current = { mode: 'pan', x0: x, view0: view, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const x = localX(e);
    setHover(x);
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'scrub') setCursor(tOf(x));
    else {
      if (Math.abs(x - d.x0) > 3) d.moved = true;
      if (d.moved) {
        const span = d.view0[1] - d.view0[0];
        const [w0, w1] = win;
        const a = clamp(d.view0[0] - ((x - d.x0) / W) * span, w0, w1 - span);
        useStore.setState({ view: [a, a + span] });
      }
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && d.mode === 'pan' && !d.moved) setCursor(tOf(localX(e)));
  };

  const zoomed = view[0] > win[0] + 1 || view[1] < win[1] - 1;
  return (
    <section className="timeline" aria-label="Shared timeline">
      <div className="tl-head">
        <PlayControls />
        <div className="tl-right">
          <span className="legend"><Why id="timeline-bands" /><i style={{ background: COLORS.sun }} />Sun <i style={{ background: COLORS.earth }} />Earth <i style={{ background: COLORS.both }} />both <i style={{ background: COLORS.eclipse }} />eclipse</span>
          {zoomed && <button className="btn sm" onClick={() => useStore.setState({ view: win })}>Reset zoom</button>}
          <span className="keys">wheel = zoom {'·'} drag = pan {'·'} drag ruler = scrub</span>
        </div>
      </div>
      <div className="tl-body" style={{ height: H }}>
        <div className="tl-labels" style={{ width: LABEL_W }}>
          <div style={{ height: AXIS_H }} />
          {ids.length === 0 && <div className="tl-empty" style={{ height: ROW_H }}>Select a site or result</div>}
          {ids.map((id) => {
            const t = targets[id];
            return (
              <div key={id} className={`tl-label ${selected === id ? 'sel' : ''}`} style={{ height: ROW_H }} onClick={() => select(id)} title={t?.name}>
                <span className="nm">{t?.rank ? `#${t.rank} ` : ''}{t?.name ?? id}</span>
                {data[id]?.loading && <span className="spin" aria-label="loading" />}
                {id !== selected && <button className="icon-btn" aria-label="Remove from timeline" onClick={(e) => { e.stopPropagation(); toggleCompare(id); }}>{'×'}</button>}
              </div>
            );
          })}
        </div>
        <div className="tl-plot" ref={wrapRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)} style={{ height: H }}>
          <canvas ref={canvasRef} style={{ width: W, height: H }} />
          {hover !== null && !drag.current && <div className="tl-hover" style={{ left: hover }}><span>{fmtUTC(tOf(hover))}</span></div>}
          {markers.filter((m) => m.t >= view[0] && m.t <= view[1]).map((m) => (
            <div key={m.kind} className={`tl-marker ${m.kind}`} style={{ left: xOf(m.t) }} title={`${m.label}: ${fmtUTC(m.t)}`}>
              <span>{m.label}</span>
            </div>
          ))}
          {cursor >= view[0] && cursor <= view[1] && (
            <div className="tl-cursor" style={{ left: xOf(cursor) }}><span className="handle" /></div>
          )}
        </div>
      </div>
    </section>
  );
}

function panBy(dt: number) {
  const s = useStore.getState();
  const [v0, v1] = s.view;
  const [w0, w1] = windowOf(s.query);
  const span = v1 - v0;
  const a = clamp(v0 + dt, w0, w1 - span);
  useStore.setState({ view: [a, a + span] });
}
