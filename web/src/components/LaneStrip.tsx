// Labelled mini strip: Sun / Earth / both lanes over a window, with an optional timeline cursor tick.
import { useEffect, useRef } from 'react';
import type { VisResult } from '../engine/api.ts';
import { useStore } from '../store.ts';
import { palette, useTheme } from '../lib/theme.ts';

const LANE = 7, GAP = 3, H = LANE * 3 + GAP * 2, W = 320;

function drawLanes(c: HTMLCanvasElement, v: VisResult | null) {
  const dpr = window.devicePixelRatio || 1;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const TONE = palette();
  const lanes = [0, LANE + GAP, 2 * (LANE + GAP)];
  g.fillStyle = TONE.laneBg;
  for (const y of lanes) g.fillRect(0, y, W, LANE);
  if (!v) return;
  const n = v.t.length;
  for (let x = 0; x < W; x++) {
    const a = Math.floor((x / W) * n), b = Math.max(a + 1, Math.floor(((x + 1) / W) * n));
    let su = 0, ea = 0, bo = 0;
    for (let i = a; i < b && i < n; i++) { const s = v.sunFrac[i] >= 0.5, e = v.earthUp[i] === 1; if (s) su++; if (e) ea++; if (s && e) bo++; }
    const m = Math.max(1, b - a);
    g.globalAlpha = su / m; g.fillStyle = TONE.sun; g.fillRect(x, lanes[0], 1, LANE);
    g.globalAlpha = ea / m; g.fillStyle = TONE.earth; g.fillRect(x, lanes[1], 1, LANE);
    g.globalAlpha = (bo / m) * 0.95; g.fillStyle = TONE.both; g.fillRect(x, lanes[2], 1, LANE);
  }
  g.globalAlpha = 1;
}

function Tick({ win }: { win: [number, number] }) {
  const cursor = useStore((s) => s.cursor);
  const f = (cursor - win[0]) / Math.max(1, win[1] - win[0]);
  if (!(f >= 0 && f <= 1)) return null;
  return <i className="pn-tick" style={{ left: `${f * 100}%` }} aria-hidden />;
}

export function LaneStrip({ vis, win, labels = true, label }: { vis: VisResult | null; win: [number, number]; labels?: boolean; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useTheme();
  useEffect(() => { if (ref.current) drawLanes(ref.current, vis); }, [vis, theme]);
  return (
    <div className="pn-strip" style={{ ['--strip-h' as string]: `${H}px` }}>
      {labels && <span className="pn-strip-l" aria-hidden><span>Sun</span><span>Earth</span><span>Both</span></span>}
      <span className="pn-strip-c">
        <canvas ref={ref} aria-label={label ?? 'Sun, Earth and both visible over the window'} />
        {!vis && <span className="ui-skel pn-strip-skel" />}
        <Tick win={win} />
      </span>
    </div>
  );
}
