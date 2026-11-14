import { useEffect, useMemo, useRef, useState } from 'react';
import { countdowns, sampleAt, type Sample } from '../lib/countdown.ts';
import { fmtUTC } from '../lib/time.ts';
import { useStore, windowOf } from '../store.ts';
import { COLORS } from './Timeline.tsx';
import { Globe as GlobeIcon, Sun, X } from 'lucide-react';
import { placeFor, shortName } from '../lib/places.ts';
import { Button, IconButton, Segmented, Tag } from './ui.tsx';

const D2R = Math.PI / 180;
const SUN_R = 0.2666; // deg
const EARTH_R = 0.95; // deg (about 1.9 deg across)

interface Star { az: number; el: number; m: number; hue: number }
function makeStars(): Star[] {
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  return Array.from({ length: 700 }, () => ({ az: rnd() * 360, el: Math.asin(rnd() * 0.95 - 0.1) / D2R, m: Math.pow(rnd(), 3), hue: rnd() }));
}
const STARS = makeStars();

function wrapDelta(a: number): number { return ((a + 540) % 360) - 180; }

function interpH(h: Float32Array, az: number): number {
  const n = h.length;
  const f = (((az % 360) + 360) % 360) / 360 * n;
  const i = Math.floor(f);
  return h[i % n] * (1 - (f - i)) + h[(i + 1) % n] * (f - i);
}

let noisePattern: HTMLCanvasElement | null = null;
function getNoise(): HTMLCanvasElement {
  if (noisePattern) return noisePattern;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(256, 256);
  let s = 99;
  for (let i = 0; i < 256 * 256; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const v = 100 + (s >>> 24) % 120;
    img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v;
    img.data[4 * i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  noisePattern = c;
  return c;
}

interface Scene { W: number; H: number; yFrac: number; lookAz: number; fov: number; vex: number; horizon: Float32Array; now: Sample }

function render(g: CanvasRenderingContext2D, sc: Scene) {
  const { W, H, yFrac, lookAz, fov, vex, horizon, now } = sc;
  const ppd = W / fov;
  const y0 = H * yFrac; // y of elevation 0 (before exaggeration)
  const X = (az: number) => W / 2 + wrapDelta(az - lookAz) * ppd;
  const Y = (el: number) => y0 - el * vex * ppd;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);

  // sky glow near Sun when it is up (scattering off dust/optics, purely cosmetic)
  const sx = X(now.sunAz), sy = Y(now.sunEl);
  const sunVisible = now.sunEl > -2;
  // stars (dimmed when Sun is high in the frame)
  const dim = now.sunUp ? 0.55 : 1;
  for (const st of STARS) {
    const x = X(st.az), y = Y(st.el);
    if (x < -2 || x > W + 2 || y < -2 || y > H) continue;
    const a = (0.25 + 0.75 * st.m) * dim;
    g.fillStyle = `hsla(${st.hue < 0.3 ? 30 : st.hue > 0.7 ? 210 : 50},40%,90%,${a})`;
    const r = 0.5 + 1.3 * st.m;
    g.fillRect(x - r / 2, y - r / 2, r, r);
  }

  if (sunVisible) {
    const R1 = Math.max(110, SUN_R * ppd * 34);
    const grd = g.createRadialGradient(sx, sy, 0, sx, sy, R1);
    const k = Math.min(1, Math.max(0, (now.sunEl + 2) / 3)) * Math.max(0.25, now.sunFrac);
    grd.addColorStop(0, `rgba(255,240,190,${0.95 * k})`);
    grd.addColorStop(0.08, `rgba(255,214,120,${0.55 * k})`);
    grd.addColorStop(0.3, `rgba(255,190,80,${0.16 * k})`);
    grd.addColorStop(1, 'rgba(255,170,40,0)');
    g.fillStyle = grd;
    g.fillRect(sx - R1, sy - R1, 2 * R1, 2 * R1);
  }
  // Sun disc (true angular size) with soft edge
  {
    const r = Math.max(2.2, SUN_R * ppd);
    const grd = g.createRadialGradient(sx, sy, r * 0.2, sx, sy, r * 1.6);
    grd.addColorStop(0, '#fffdf2'); grd.addColorStop(0.62, '#fff3c4'); grd.addColorStop(0.7, 'rgba(255,220,120,0.6)'); grd.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(sx, sy, r * 1.6, 0, 7); g.fill();
  }

  // Earth with phase
  drawEarth(g, X(now.earthAz), Y(now.earthEl), EARTH_R * ppd, { sx, sy }, now);

  // ground: skyline polygon filled grey (drawn over Sun/Earth so they are clipped by the ridge)
  const x0 = 0, steps = Math.ceil(W / 2);
  g.beginPath();
  g.moveTo(0, H);
  for (let i = 0; i <= steps; i++) {
    const px = (i / steps) * W;
    const az = lookAz + (px - W / 2) / ppd;
    g.lineTo(px, Y(interpH(horizon, az)));
  }
  g.lineTo(W, H);
  g.closePath();
  const clipPath = new Path2D();
  clipPath.moveTo(0, H);
  for (let i = 0; i <= steps; i++) { const px = (i / steps) * W; clipPath.lineTo(px, Y(interpH(horizon, lookAz + (px - W / 2) / ppd))); }
  clipPath.lineTo(W, H);
  clipPath.closePath();
  const lit = Math.min(1, Math.max(0, now.sunEl / 3 + 0.5)) * (now.sunUp ? 1 : 0.0);
  const earthshine = now.earthUp ? 0.07 : 0.015;
  const base = 22 + 105 * lit;
  const grad = g.createLinearGradient(0, y0 - 80, 0, H);
  grad.addColorStop(0, `rgb(${base + 20 * lit + earthshine * 120},${base + 18 * lit + earthshine * 140},${base + 12 * lit + earthshine * 220})`);
  grad.addColorStop(1, `rgb(${base * 0.35 + 6},${base * 0.35 + 6},${base * 0.38 + 8})`);
  g.fillStyle = grad;
  g.fill();
  // regolith speckle
  g.save();
  g.clip();
  g.globalAlpha = 0.07 + 0.1 * lit;
  g.globalCompositeOperation = 'overlay';
  const pat = g.createPattern(getNoise(), 'repeat');
  if (pat) { g.fillStyle = pat; g.fillRect(0, 0, W, H); }
  g.globalCompositeOperation = 'source-over';
  // sunlit rim: brighter toward the Sun's azimuth
  if (lit > 0) {
    const sg = g.createLinearGradient(sx - 400, 0, sx + 400, 0);
    sg.addColorStop(0, 'rgba(255,215,150,0)'); sg.addColorStop(0.5, `rgba(255,215,150,${0.28 * lit})`); sg.addColorStop(1, 'rgba(255,215,150,0)');
    g.globalAlpha = 1; g.fillStyle = sg; g.fillRect(0, y0 - 300, W, H);
  }
  g.restore();
  // slope shading: terrain facing the Sun is brighter (derived from the skyline gradient)
  if (lit > 0) {
    g.save();
    g.clip(clipPath);
    for (let px = 0; px < W; px += 4) {
      const az = lookAz + (px - W / 2) / ppd;
      const grad2 = (interpH(horizon, az + 0.4) - interpH(horizon, az - 0.4)) / 0.8; // deg/deg
      const sunSide = Math.max(-1, Math.min(1, wrapDelta(now.sunAz - az) / 30));
      const f = Math.max(-1, Math.min(1, -grad2 * sunSide * 5));
      const y = Y(interpH(horizon, az));
      g.fillStyle = f > 0 ? `rgba(255,226,170,${0.22 * f * lit})` : `rgba(0,0,0,${0.35 * -f * lit})`;
      g.fillRect(px, y, 4, H - y);
    }
    g.restore();
  }
  // skyline rim light
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const px = (i / steps) * W;
    const az = lookAz + (px - W / 2) / ppd;
    const y = Y(interpH(horizon, az));
    if (i === 0) g.moveTo(px, y); else g.lineTo(px, y);
  }
  g.strokeStyle = lit > 0 ? 'rgba(255,230,180,0.55)' : 'rgba(150,170,210,0.35)';
  g.lineWidth = 1.2;
  g.stroke();
  void x0;

  // compass strip
  const stripH = 42;
  g.fillStyle = 'rgba(5,7,12,0.86)';
  g.fillRect(0, H - stripH, W, stripH);
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, H - stripH, W, 1);
  g.strokeStyle = 'rgba(200,210,230,0.8)';
  g.fillStyle = '#c9d2e6';
  g.font = '600 12px ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center';
  const a0 = Math.floor((lookAz - fov / 2) / 5) * 5;
  for (let a = a0; a <= lookAz + fov / 2 + 5; a += 5) {
    const x = W / 2 + (a - lookAz) * ppd;
    const az = ((a % 360) + 360) % 360;
    const major = az % 15 === 0;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, H - stripH); g.lineTo(x, H - stripH + (major ? 10 : 5)); g.stroke();
    if (az % 45 === 0) {
      const names: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
      g.fillStyle = az % 90 === 0 ? '#fff' : '#dbe2f1';
      g.font = `700 ${az % 90 === 0 ? 16 : 13}px "Inter Variable", ui-sans-serif, system-ui, sans-serif`;
      g.fillText(names[az], x, H - 10);
    } else if (major) { g.fillStyle = '#a3adc4'; g.font = '500 11.5px "JetBrains Mono", ui-monospace, monospace'; g.fillText(`${az}\u00b0`, x, H - 10); }
  }
  // markers for Sun and Earth azimuth on the strip
  for (const [az, c] of [[now.sunAz, COLORS.sun], [now.earthAz, COLORS.earth]] as [number, string][]) {
    const x = X(az);
    if (x > 0 && x < W) { g.fillStyle = c; g.beginPath(); g.moveTo(x, H - stripH); g.lineTo(x - 5, H - stripH - 8); g.lineTo(x + 5, H - stripH - 8); g.fill(); }
  }
  g.textAlign = 'left';
}

function drawEarth(g: CanvasRenderingContext2D, x: number, y: number, R: number, sun: { sx: number; sy: number }, now: Sample) {
  if (x < -R * 3 || x > g.canvas.width + R * 3) { /* far outside view */ }
  R = Math.max(R, 5);
  g.save();
  g.translate(x, y);
  // glow
  const halo = g.createRadialGradient(0, 0, R * 0.9, 0, 0, R * 2.2);
  halo.addColorStop(0, 'rgba(120,180,255,0.35)'); halo.addColorStop(1, 'rgba(120,180,255,0)');
  g.fillStyle = halo; g.beginPath(); g.arc(0, 0, R * 2.2, 0, 7); g.fill();
  // dark disc
  g.fillStyle = '#071125';
  g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
  // phase: angle between Sun and Earth directions
  const e1 = now.earthEl * D2R, e2 = now.sunEl * D2R, da = (now.earthAz - now.sunAz) * D2R;
  const cosPsi = Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos(da);
  const theta = Math.atan2(sun.sy - y, sun.sx - x);
  g.rotate(theta);
  const xt = R * cosPsi; // terminator crossing on the Sun-facing axis
  g.beginPath();
  g.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false);
  const rx = Math.max(0.001, Math.abs(xt));
  if (xt < 0) g.ellipse(0, 0, rx, R, 0, Math.PI / 2, (3 * Math.PI) / 2, false);
  else g.ellipse(0, 0, rx, R, 0, Math.PI / 2, -Math.PI / 2, true);
  g.closePath();
  g.save();
  g.clip();
  g.rotate(-theta);
  const body = g.createRadialGradient(-R * 0.25, -R * 0.25, R * 0.1, 0, 0, R);
  body.addColorStop(0, '#d8ecff'); body.addColorStop(0.45, '#5aa0f0'); body.addColorStop(1, '#1d4f9e');
  g.fillStyle = body; g.fillRect(-R, -R, 2 * R, 2 * R);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (const [cx, cy, rx2, ry2, rot] of [[-0.3, -0.2, 0.55, 0.12, 0.4], [0.2, 0.25, 0.5, 0.1, -0.3], [0.1, -0.45, 0.4, 0.09, 0.1], [-0.4, 0.4, 0.3, 0.08, 0.7]]) {
    g.beginPath(); g.ellipse(cx * R, cy * R, rx2 * R, ry2 * R, rot, 0, 7); g.fill();
  }
  g.fillStyle = 'rgba(90,150,90,0.35)';
  g.beginPath(); g.ellipse(-0.1 * R, 0.05 * R, 0.25 * R, 0.18 * R, 0.5, 0, 7); g.fill();
  g.restore();
  g.restore();
}

export function FirstPerson() {
  const open = useStore((s) => s.fpOpen);
  const id = useStore((s) => s.selected);
  const t = useStore((s) => (s.selected ? s.targets[s.selected] : undefined));
  const d = useStore((s) => (s.selected ? s.data[s.selected] : undefined));
  const cursor = useStore((s) => s.cursor);
  const query = useStore((s) => s.query);
  const sites = useStore((s) => s.sites);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ W: 1000, H: 520 });
  const [lookAz, setLookAz] = useState(0);
  const [fov, setFov] = useState(90);
  const [yFrac, setYFrac] = useState(0.7);
  const [vex, setVex] = useState<1 | 3>(3);
  const drag = useRef<{ x: number; y: number; az: number; yf: number } | null>(null);
  const win = useMemo(() => windowOf(query), [query]);

  // initial look direction: toward the Sun (or Earth if the Sun is down)
  const initFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !id || !d?.vis || initFor.current === id) return;
    const s = sampleAt(d.vis, cursor);
    if (s) { if (s.sunUp || s.sunEl > -3) center(s.sunAz, s.sunEl); else center(s.earthAz, s.earthEl); initFor.current = id; }
  }, [open, id, d?.vis]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) initFor.current = null; }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ W: Math.floor(el.clientWidth), H: Math.floor(el.clientHeight) }));
    ro.observe(el);
    setSize({ W: el.clientWidth, H: el.clientHeight });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useStore.setState({ fpOpen: false }); };
    window.addEventListener('keydown', onKey);
    return () => { ro.disconnect(); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const now = sampleAt(d?.vis, cursor);
  const center = (az: number, el: number) => {
    setLookAz(az);
    setYFrac(Math.max(0.2, Math.min(1.4, 0.55 + (el * vex * size.W) / fov / size.H)));
  };
  useEffect(() => {
    const c = canvasRef.current;
    if (!open || !c || !d?.horizon || !now) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.W * dpr; c.height = size.H * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(g, { W: size.W, H: size.H, yFrac, lookAz, fov, vex, horizon: d.horizon.elevDeg, now });
  });

  if (!open || !t) return null;
  const cd = countdowns(d?.vis, cursor, win[1]);
  const place = t.kind === 'site' ? shortName(t.name) : placeFor(t.lat, t.lon, sites).title;
  const close = () => useStore.setState({ fpOpen: false });
  return (
    <div className="fp" ref={hostRef}>
      <canvas
        ref={canvasRef} style={{ width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, az: lookAz, yf: yFrac }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setYFrac(Math.max(0.15, Math.min(1.6, drag.current.yf + (e.clientY - drag.current.y) / size.H))); if (drag.current) setLookAz((((drag.current.az - ((e.clientX - drag.current.x) * fov) / size.W) % 360) + 360) % 360); }}
        onPointerUp={() => { drag.current = null; }}
        onWheel={(e) => setFov((f) => Math.min(120, Math.max(20, f * Math.exp(e.deltaY * 0.001))))}
        aria-label="First-person view from the site: drag to look around, wheel to zoom"
      />
      <div className="fp-card">
        <div>
          <h2>{t.rank ? `#${t.rank} ` : ''}{place}</h2>
          <div className="fp-sub">{t.lat.toFixed(3)}{'\u00b0'}, {t.lon.toFixed(3)}{'\u00b0'} {'\u00b7'} {query.height_m} m above terrain</div>
        </div>
        {cd && (
          <div className="fp-cds">
            <div className={`fp-cd sun ${cd.sunSoon ? 'soon' : ''}`}><Sun aria-hidden />{cd.sun}</div>
            <div className={`fp-cd earth ${cd.earthSoon ? 'soon' : ''}`}><GlobeIcon aria-hidden />{cd.earth}</div>
          </div>
        )}
        <div className="fp-meta">
          <span>{fmtUTC(cursor)}</span>
          {now && <span>Sun {now.sunEl.toFixed(2)}{'\u00b0'}{now.sunUp ? '' : ' (down)'} {'\u00b7'} Earth {now.earthEl.toFixed(1)}{'\u00b0'}{now.earthUp ? '' : ' (hidden)'}{now.eclipseFrac > 0 ? ` \u00b7 eclipse ${Math.round(now.eclipseFrac * 100)}%` : ''}</span>}
        </div>
      </div>
      <div className="fp-close"><IconButton solid tip="left" icon={X} label="Close first-person view (Esc)" onClick={close} /></div>
      <div className="fp-ctl">
        <Button size="sm" icon={Sun} onClick={() => now && center(now.sunAz, now.sunEl)}>Look at Sun</Button>
        <Button size="sm" icon={GlobeIcon} onClick={() => now && center(now.earthAz, now.earthEl)}>Look at Earth</Button>
        <Segmented label="Vertical exaggeration" value={String(vex) as '1' | '3'} onChange={(v) => setVex(v === '1' ? 1 : 3)} options={[{ value: '1', label: '1\u00d7' }, { value: '3', label: '3\u00d7' }]} />
      </div>
      <div className="fp-hint">drag to look {'\u00b7'} wheel to zoom ({fov.toFixed(0)}{'\u00b0'} FOV) {'\u00b7'} scrub the timeline below</div>
      {vex === 3 && <div className="fp-flag"><Tag tone="warn">Vertical scale exaggerated 3{'\u00d7'} (Sun and Earth sizes stay true)</Tag></div>}
      {!d?.horizon && <div className="fp-flag"><Tag tone="info">Loading horizon{'\u2026'}</Tag></div>}
    </div>
  );
}
