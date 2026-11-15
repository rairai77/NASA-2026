import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { VisResult } from '../engine/api.ts';
import { DAY, HOUR, clamp, fmtUTC } from '../lib/time.ts';
import { select, setCursor, toggleCompare, useActiveIds, useStore, windowOf } from '../store.ts';
import { ChevronDown, ChevronUp, HelpCircle, Info, Pause, Play, StepBack, StepForward, X } from 'lucide-react';
import { sampleAt } from '../lib/countdown.ts';
import { placeFor, shortName } from '../lib/places.ts';
import { cssVar, palette, useTheme } from '../lib/theme.ts';
import { Button, Dot, IconButton, Kbd, Popover, Segmented, Tooltip, Why } from './ui.tsx';

// Static (dark) colours for code that draws on the always-dark globe/first-person view. Timeline canvases read theme-aware values from palette().
export const COLORS = { sun: '#f5b700', earth: '#4fa3ff', both: '#ffffff', eclipse: '#ff4fd8' };
const ROW_H = 56;
const AXIS_H = 26;
const MAX_ROWS_VISIBLE = 4;
export const COMMS_COLORS = { clear: '#34d399', marginal: '#b388ff', gap: '#ef4444' };
// lane geometry inside a row (offsets from the row's y): sun, earth, both, comms
const LANES: [number, number][] = [[3, 11], [16, 11], [29, 9], [40, 9]];

function laneBackgrounds(g: CanvasRenderingContext2D, W: number, y: number, lanes: [number, number][]) {
  g.fillStyle = palette().laneBg;
  g.beginPath();
  for (const [o, h] of lanes) g.roundRect(0, y + o, W, h, 3);
  g.fill();
}
function laneClip(g: CanvasRenderingContext2D, W: number, y: number, lanes: [number, number][]) {
  g.beginPath();
  for (const [o, h] of lanes) g.roundRect(0, y + o, W, h, 3);
  g.clip();
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');
/** "Tue 17 Nov 2026 \u00b7 00:00 UTC" */
export function fmtClock(t: number): string {
  const d = new Date(t * 1000);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} \u00b7 ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}

/** Comms lane under a row: clear / marginal (Earth skims the skyline) / DSN gap (Earth up but no DSN dish sees the Moon).
 *  With a relay orbiter assumed the whole lane is clear. Needs linkMargin (and dsnUp) from the engine. */
export function drawCommsRow(g: CanvasRenderingContext2D, v: VisResult | undefined, x: (t: number) => number, v0: number, v1: number, W: number, y: number, relay = false) {
  const [co, ch] = LANES[3];
  const P = palette();
  laneBackgrounds(g, W, y, [LANES[3]]);
  if (!v || v.t.length < 2 || (!v.linkMargin && !relay)) return;
  g.save(); laneClip(g, W, y, [LANES[3]]);
  const n = v.t.length, step = v.t[1] - v.t[0], t0 = v.t[0];
  const iA = clamp(Math.floor((v0 - t0) / step) - 1, 0, n - 1);
  const iB = clamp(Math.ceil((v1 - t0) / step) + 1, 0, n - 1);
  const pxPerStep = Math.abs(x(t0 + step) - x(t0));
  const cols = Math.ceil(W);
  const cl = new Float32Array(cols), ma = new Float32Array(cols), gp = new Float32Array(cols), cnt = new Float32Array(cols);
  for (let i = iA; i <= iB; i++) {
    const px0 = x(v.t[i]);
    const a = Math.max(0, Math.floor(px0)), b = Math.min(cols - 1, Math.max(a, Math.ceil(px0 + pxPerStep) - 1));
    const lm = relay ? 2 : v.linkMargin![i];
    const gap = !relay && v.dsnUp ? v.dsnUp[i] === 0 : false;
    for (let c = a; c <= b; c++) {
      cnt[c]++;
      if (lm === 0) continue;
      if (gap) gp[c]++; else if (lm === 1) ma[c]++; else cl[c]++;
    }
  }
  for (let c = 0; c < cols; c++) {
    if (!cnt[c]) continue;
    g.globalAlpha = cl[c] / cnt[c]; g.fillStyle = P.comms; g.fillRect(c, y + co, 1, ch);
    g.globalAlpha = ma[c] / cnt[c]; g.fillStyle = P.marginal; g.fillRect(c, y + co, 1, ch);
    g.globalAlpha = gp[c] / cnt[c]; g.fillStyle = P.gap; g.fillRect(c, y + co, 1, ch);
  }
  g.globalAlpha = 1;
  g.restore();
}

export const SPEEDS: [string, number][] = [['1 h/s', HOUR], ['6 h/s', 6 * HOUR], ['1 d/s', DAY]];

export function drawRow(g: CanvasRenderingContext2D, v: VisResult | undefined, x: (t: number) => number, v0: number, v1: number, W: number, y: number) {
  laneBackgrounds(g, W, y, LANES.slice(0, 3));
  if (!v || v.t.length < 2) return;
  const P = palette();
  g.save(); laneClip(g, W, y, LANES.slice(0, 3));
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
    g.globalAlpha = su[c] / cnt[c]; g.fillStyle = P.sun; g.fillRect(c, y + LANES[0][0], 1, LANES[0][1]);
    g.globalAlpha = ea[c] / cnt[c]; g.fillStyle = P.earth; g.fillRect(c, y + LANES[1][0], 1, LANES[1][1]);
    g.globalAlpha = bo[c] / cnt[c]; g.fillStyle = P.both; g.fillRect(c, y + LANES[2][0], 1, LANES[2][1]);
    if (ec[c]) { g.globalAlpha = 1; g.fillStyle = P.ecl; g.fillRect(c, y + LANES[0][0], 1, LANES[0][1]); }
  }
  g.globalAlpha = 1;
  g.restore();
}

const SPEED_KEYS = SPEEDS.map(([l]) => l);

function Help({ relay }: { relay: boolean }) {
  const rows: [React.ReactNode, string][] = [
    [<Kbd key="a">Space</Kbd>, 'play / pause'],
    [<><Kbd>{'\u2190'}</Kbd> <Kbd>{'\u2192'}</Kbd></>, 'step 1 hour'],
    [<><Kbd>Shift</Kbd> + <Kbd>{'\u2190'}</Kbd> <Kbd>{'\u2192'}</Kbd></>, 'step 1 day'],
    [<Kbd key="w">wheel</Kbd>, 'zoom the timeline'],
    [<><Kbd>Shift</Kbd> + <Kbd>wheel</Kbd></>, 'pan'],
    [<Kbd key="d">drag</Kbd>, 'scrub the time cursor'],
    [<><Kbd>Shift</Kbd> + <Kbd>drag</Kbd></>, 'pan (or middle-drag)'],
    [<Kbd key="c">click</Kbd>, 'move the cursor there'],
  ];
  const card = (
    <div className="tl-help-card">
      <div className="ui-section-title">Shortcuts</div>
      {rows.map(([k, d], i) => <div key={i} className="tl-help-row"><span>{k}</span><span>{d}</span></div>)}
      <div className="tl-help-legend">
        <div className="ui-section-title">Legend</div>
        <Legend relay={relay} />
      </div>
    </div>
  );
  return (
    <>
      <span className="desk-only">
        <Tooltip side="top" wrap content={card}>
          <IconButton tip="none" size="sm" icon={HelpCircle} label="Timeline help and legend" />
        </Tooltip>
      </span>
      {/* phone: hover tooltips do not exist, so help opens on tap */}
      <Popover className="phone-only tl-help-pop" trigger={(open, toggle) => <IconButton tip="none" size="sm" icon={HelpCircle} label="Timeline help and legend" active={open} onClick={toggle} />}>
        {card}
      </Popover>
    </>
  );
}

function Legend({ relay }: { relay: boolean }) {
  return (
    <span className="tl-legend">
      <span><Dot tone="sun" />Sun</span><span><Dot tone="earth" />Earth</span><span><Dot tone="both" />Both</span><span><Dot tone="ecl" />Eclipse</span>
      <span className="sep" />
      <span><Dot tone="comms" />Comms clear</span><span><Dot tone="marginal" />Marginal</span><span><Dot tone="gap" />DSN gap</span>
      {relay && <span className="note">(Relay assumed)</span>}
    </span>
  );
}

function Header({ win, zoomed, allowCollapse }: { win: [number, number]; zoomed: boolean; allowCollapse: boolean }) {
  const collapsed = useStore((s) => s.timelineCollapsed);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const cursor = useStore((s) => s.cursor);
  const relay = useStore((s) => s.query.relay === true);
  const day = Math.max(1, Math.floor((cursor - win[0]) / DAY) + 1);
  const total = Math.max(1, Math.round((win[1] - win[0]) / DAY));
  const speedKey = SPEEDS.find(([, v]) => v === speed)?.[0] ?? SPEED_KEYS[1];
  const step = (dir: 1 | -1) => (e: React.MouseEvent) => setCursor(useStore.getState().cursor + dir * (e.shiftKey ? DAY : HOUR));
  return (
    <div className="tl-head">
      <div className="tl-controls">
        <Tooltip side="top" content={<>{playing ? 'Pause' : 'Play'} <Kbd>Space</Kbd></>}>
          <button type="button" className="tl-play" onClick={() => useStore.setState({ playing: !playing })} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          </button>
        </Tooltip>
        <Segmented label="Playback speed" value={speedKey} onChange={(k) => useStore.setState({ speed: SPEEDS.find(([l]) => l === k)![1] })}
          options={SPEEDS.map(([l]) => ({ value: l, label: l }))} />
        <span className="tl-steps">
          <IconButton tip="top" icon={StepBack} label="Back 1 h \u00b7 Shift for 1 day" onClick={step(-1)} />
          <IconButton tip="top" icon={StepForward} label="Forward 1 h \u00b7 Shift for 1 day" onClick={step(1)} />
        </span>
      </div>
      <div className="tl-time" aria-live="off">
        <span className="tl-clock">{fmtClock(cursor)}</span>
        <span className="tl-day">day {day} of {total}</span>
      </div>
      <div className="tl-right">
        <span className="tl-legend-wrap"><Why id="timeline-bands" /><Legend relay={relay} /></span>
        {zoomed && <Button size="sm" variant="ghost" onClick={() => useStore.setState({ view: win })}>Reset zoom</Button>}
        <Help relay={relay} />
        {allowCollapse && <IconButton tip="top" size="sm" icon={collapsed ? ChevronUp : ChevronDown} label={collapsed ? 'Expand the timeline' : 'Collapse the timeline to its header'} onClick={() => useStore.setState({ timelineCollapsed: !collapsed })} />}
      </div>
      <div className="tl-legend-compact"><Legend relay={relay} /></div>
    </div>
  );
}

export function Timeline({ allowCollapse = true }: { allowCollapse?: boolean }) {
  const collapsed = useStore((s) => s.timelineCollapsed) && allowCollapse;
  const ids = useActiveIds();
  const targets = useStore((s) => s.targets);
  const data = useStore((s) => s.data);
  const selected = useStore((s) => s.selected);
  const view = useStore((s) => s.view);
  const query = useStore((s) => s.query);
  const cursor = useStore((s) => s.cursor);
  const markers = useStore((s) => s.markers);
  const theme = useTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [W, setW] = useState(800);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const sites = useStore((s) => s.sites);
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
    const P = palette();
    const scale = d3.scaleUtc().domain([new Date(view[0] * 1000), new Date(view[1] * 1000)]).range([0, W]);
    const ticks = scale.ticks(Math.max(3, Math.floor(W / 110)));
    const fmt = scale.tickFormat(Math.max(3, Math.floor(W / 110)));
    g.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
    g.textBaseline = 'middle';
    g.strokeStyle = P.border; g.fillStyle = P.text3;
    for (const tk of ticks) {
      const x = Math.round(scale(tk)) + 0.5;
      g.beginPath(); g.moveTo(x, AXIS_H - 6); g.lineTo(x, H); g.stroke();
      g.fillText(fmt(tk), x + 4, 10);
    }
    // window edges
    g.fillStyle = cssVar('--bg'); g.globalAlpha = 0.55;
    const xa = xOf(win[0]), xb = xOf(win[1]);
    if (xa > 0) g.fillRect(0, AXIS_H, xa, H - AXIS_H);
    if (xb < W) g.fillRect(xb, AXIS_H, W - xb, H - AXIS_H);
    g.globalAlpha = 1;
    ids.forEach((id, i) => {
      drawRow(g, data[id]?.vis, xOf, view[0], view[1], W, AXIS_H + i * ROW_H);
      drawCommsRow(g, data[id]?.vis, xOf, view[0], view[1], W, AXIS_H + i * ROW_H, query.relay === true);
    });
  }, [ids, data, view, W, H, win, xOf, query.relay, theme]);

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
    const x = localX(e);
    if (e.button !== 0 && e.button !== 1) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // press-drag anywhere scrubs the cursor; Shift-drag or middle-drag pans the view
    if (e.shiftKey || e.button === 1) { e.preventDefault(); drag.current = { mode: 'pan', x0: x, view0: view, moved: false }; wrapRef.current!.dataset.drag = 'pan'; }
    else { drag.current = { mode: 'scrub', x0: x, view0: view, moved: true }; setCursor(tOf(x)); wrapRef.current!.dataset.drag = 'scrub'; }
  };
  const onMove = (e: React.PointerEvent) => {
    const x = localX(e);
    wrapRef.current!.dataset.pan = e.shiftKey ? '1' : '';
    setHover({ x, y: e.clientY - wrapRef.current!.getBoundingClientRect().top });
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
    if (wrapRef.current) wrapRef.current.dataset.drag = '';
    if (d && d.mode === 'pan' && !d.moved) setCursor(tOf(localX(e)));
  };

  const zoomed = view[0] > win[0] + 1 || view[1] < win[1] - 1;
  // distinguishing part first: the name for named places, the coordinates for unnamed ones
  const rowName = (id: string): { name: string; sub?: string } => {
    const t = targets[id];
    if (!t) return { name: id };
    const coords = fmtCoords(t.lat, t.lon);
    if (t.kind === 'site') return { name: shortName(t.name), sub: coords };
    const pl = placeFor(t.lat, t.lon, sites);
    return pl.near ? { name: pl.title, sub: coords } : { name: coords };
  };
  let hoverCard: React.ReactNode = null;
  if (hover && !drag.current) {
    const th = tOf(hover.x);
    const ri = Math.floor((hover.y - AXIS_H) / ROW_H);
    const hid = ri >= 0 && ri < ids.length ? ids[ri] : null;
    const sm = hid ? sampleAt(data[hid]?.vis, th) : null;
    hoverCard = (
      <div className="tl-hover" style={{ left: hover.x }}>
        <div className={`tl-hover-card ${hover.x > W - 190 ? 'left' : ''}`}>
          <b>{fmtClock(th)}</b>
          {sm && hid && (
            <span className="tl-hover-st">
              <span><Dot tone="sun" />{sm.sunUp ? `Sun up ${sm.sunEl.toFixed(1)}\u00b0` : 'Sun down'}</span>
              <span><Dot tone="earth" />{sm.earthUp ? `Earth up ${sm.earthEl.toFixed(1)}\u00b0` : 'Earth down'}</span>
              {sm.eclipseFrac > 0 && <span><Dot tone="ecl" />eclipse {Math.round(sm.eclipseFrac * 100)}%</span>}
            </span>
          )}
        </div>
      </div>
    );
  }
  return (
    <section className={`timeline ${collapsed ? 'is-collapsed' : ''}`} aria-label="Shared timeline" data-tour="timeline">
      <Header win={win} zoomed={zoomed} allowCollapse={allowCollapse} />
      <div className="tl-body" style={{ height: Math.min(H, AXIS_H + MAX_ROWS_VISIBLE * ROW_H) }} hidden={collapsed}>
        <div className="tl-labels" style={{ height: H }}>
          <div style={{ height: AXIS_H }} />
          {ids.length === 0 && <div className="tl-empty" style={{ height: ROW_H }}>Select a site or result</div>}
          {ids.map((id) => {
            const t = targets[id];
            const nm = rowName(id);
            const lbl = nm.sub ? `${nm.name} (${nm.sub})` : nm.name;
            return (
              <div key={id} className={`tl-label ${selected === id ? 'sel' : ''}`} style={{ height: ROW_H }} onClick={() => select(id)} title={t && t.kind === 'site' ? t.name : lbl}>
                <span className="nm">{t?.rank ? <span className={`tl-rank ${t.rank === 1 ? 'gold' : ''}`}>{t.rank}</span> : null}<span className="tn"><span className="t">{nm.name}</span>{nm.sub && <span className="tsub">{nm.sub}</span>}</span></span>
                {data[id]?.loading && <span className="ui-spinner" aria-label="loading" />}
                {id !== selected && <button className="tl-x" aria-label={`Remove ${nm.name} from timeline`} onClick={(e) => { e.stopPropagation(); toggleCompare(id); }}><X aria-hidden /></button>}
                <span className="tl-lanes" aria-hidden>
                  {['Sun', 'Earth', 'Both', 'Comms'].map((l, i) => <i key={l} style={{ top: LANES[i][0] + LANES[i][1] / 2 }}>{l}</i>)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="tl-plot" ref={wrapRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)} style={{ height: H }}>
          <canvas ref={canvasRef} style={{ width: W, height: H }} />
          {hoverCard}
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
      {!collapsed && ids.length === 1 && <p className="tl-hint"><Info aria-hidden />Use Add to timeline on other sites to compare them here.</p>}
    </section>
  );
}

function fmtCoords(lat: number, lon: number): string {
  const l = ((lon + 540) % 360) - 180;
  return `${Math.abs(lat).toFixed(1)}\u00b0 ${lat < 0 ? 'S' : 'N'}, ${Math.abs(l).toFixed(1)}\u00b0 ${l < 0 ? 'W' : 'E'}`;
}

function panBy(dt: number) {
  const s = useStore.getState();
  const [v0, v1] = s.view;
  const [w0, w1] = windowOf(s.query);
  const span = v1 - v0;
  const a = clamp(v0 + dt, w0, w1 - span);
  useStore.setState({ view: [a, a + span] });
}
