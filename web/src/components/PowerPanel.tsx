// Compact lander power card for the selected-site drawer: panel + battery inputs, energy over the window,
// "survives the longest night" verdict and a power-vs-time sparkline aligned to the timeline window.
import { useEffect, useRef, useState } from 'react';
import type { Panel, PanelKind, PowerResult } from '../engine/api.ts';
import { getEngine } from '../engine/client.ts';
import { fmtDur, HOUR } from '../lib/time.ts';
import { patchQuery, seriesStep, setPanel, useStore, windowOf, type Target } from '../store.ts';
import { Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Settings2, Zap } from 'lucide-react';
import { palette, useTheme } from '../lib/theme.ts';
import { Button, NumInput, Stat } from './ui.tsx';

export const PANEL_KINDS: [PanelKind, string][] = [
  ['vertical_tracking', 'Vertical, sun-tracking'],
  ['vertical_fixed', 'Vertical, fixed'],
  ['horizontal', 'Horizontal (flat)'],
];

export function panelSummary(p: Panel): string {
  const k = PANEL_KINDS.find((x) => x[0] === p.kind)?.[1].toLowerCase() ?? p.kind;
  return `${p.areaM2} m², ${k}, ${p.loadW} W load`;
}

/** The panel inputs, shared by the drawer card and the query-bar popover. */
export function PanelFields({ panel, onChange }: { panel: Panel; onChange: (p: Panel) => void }) {
  const set = (p: Partial<Panel>) => onChange({ ...panel, ...p });
  return (
    <div className="ed">
      <label>Panel type
        <select value={panel.kind} onChange={(e) => set({ kind: e.target.value as PanelKind })}>
          {PANEL_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <div className="grid4">
        {panel.kind === 'vertical_fixed' && <label>Panel azimuth ({'°'} from N)<NumInput value={panel.azimuthDeg ?? 0} min={0} max={360} width={64} onChange={(v) => set({ azimuthDeg: v })} /></label>}
        <label>Area (m{'²'})<NumInput value={panel.areaM2} min={0.1} step={0.5} width={64} onChange={(v) => v > 0 && set({ areaM2: v })} /></label>
        <label>Efficiency (0{'–'}1)<NumInput value={panel.efficiency} min={0.01} max={1} step={0.01} width={64} onChange={(v) => v > 0 && v <= 1 && set({ efficiency: v })} /></label>
        <label>Load (W)<NumInput value={panel.loadW} min={0} step={10} width={64} onChange={(v) => set({ loadW: v })} /></label>
        <label>Battery (Wh)<NumInput value={panel.batteryWh ?? 0} min={0} step={100} width={64} onChange={(v) => set({ batteryWh: v })} /></label>
        <label>Depth of discharge<NumInput value={panel.depthOfDischarge} min={0.05} max={1} step={0.05} width={64} onChange={(v) => v > 0 && v <= 1 && set({ depthOfDischarge: v })} /></label>
      </div>
    </div>
  );
}

const fmtWh = (v: number) => (Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(1)} kWh` : `${Math.round(v)} Wh`);
function whParts(v: number): { value: string; unit: string } {
  return Math.abs(v) >= 10000 ? { value: (v / 1000).toFixed(1), unit: 'kWh' } : { value: String(Math.round(v)), unit: 'Wh' };
}

export function PowerPanel({ target }: { target: Target }) {
  const panel = useStore((s) => s.panel);
  const attached = useStore((s) => !!s.query.power);
  const query = useStore((s) => s.query);
  const horizon = useStore((s) => s.data[target.id]?.horizon);
  const cursor = useStore((s) => s.cursor);
  const [res, setRes] = useState<PowerResult | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'unsupported' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const win = windowOf(query);
  const cur = useRef<object>({});

  useEffect(() => {
    if (!horizon) return;
    const seq = {}; cur.current = seq;
    setState('busy');
    const h = setTimeout(async () => {
      try {
        const r = await getEngine().power(target.lat, target.lon, win[0], win[1], panel, { heightM: query.height_m, stepS: seriesStep(query), elevDeg: horizon.elevDeg });
        if (cur.current !== seq) return;
        if (!r) { setState('unsupported'); setRes(null); } else { setRes(r); setState('idle'); }
      } catch (e) { if (cur.current === seq) { setErr(String((e as Error).message ?? e)); setState('error'); } }
    }, 250);
    return () => clearTimeout(h);
  }, [target.lat, target.lon, win[0], win[1], panel, query.height_m, horizon]); // eslint-disable-line react-hooks/exhaustive-deps

  const spanH = (win[1] - win[0]) / HOUR;
  const survives = res ? res.survivesNight : null;
  const battery = panel.batteryWh ?? 0;
  const e = res ? whParts(res.energyWh) : null, perDay = res ? whParts(res.whPerDay) : null, need = res ? whParts(res.batteryWhNeeded) : null;
  return (
    <div className="pn-pane">
      {state === 'busy' && !res && <div className="ui-skel pn-plot-skel" style={{ height: 120 }} />}
      {state === 'unsupported' && <p className="pn-hint">The power model needs the real engine (demo mode has none).</p>}
      {state === 'error' && <p className="pn-err">{err}</p>}
      {res && (
        <>
          <div className={`pn-verdict ${survives ? 'yes' : 'caution'}`} role="status">
            {survives ? <CircleCheck aria-hidden /> : <CircleAlert aria-hidden />}
            <div>
              <b>{survives
                ? `The example lander (${fmtWh(battery)} battery) would get through this site's ${(res.longestDarkH / 24).toFixed(1)}-day night.`
                : `The example lander (${fmtWh(battery)} battery) would run out during this site's ${(res.longestDarkH / 24).toFixed(1)}-day night. Set your own lander in the panel settings.`}</b>
              <small>{res.longestDarkH > 0
                ? `Longest dark: ${fmtDur(res.longestDarkH * HOUR)}. Needs ${fmtWh(res.batteryWhNeeded)} usable (${panel.loadW} W ${'×'} ${res.longestDarkH.toFixed(0)} h / ${panel.depthOfDischarge}); you have ${fmtWh(battery)}.`
                : 'No dark period in this window.'}</small>
            </div>
          </div>
          <div className="pn-stats pn-stats--4">
            <Stat label="Energy" value={e!.value} unit={e!.unit} tone="sun" title="Energy over the window" />
            <Stat label="Per day" value={perDay!.value} unit={`${perDay!.unit}/d`} title="Average per day" />
            <Stat label="Battery" value={need!.value} unit={need!.unit} tone={survives ? 'ok' : 'warn'} title="Battery needed" />
            <Stat label="Longest dark" value={res.longestDarkH.toFixed(0)} unit="h" title={`${(res.longestDarkH / 24).toFixed(1)} days`} />
          </div>
          <PowerSpark res={res} win={win} cursor={cursor} panel={panel} />
          <p className="pn-small">Load over window: <span className="mono">{fmtWh(panel.loadW * spanH)}</span></p>
        </>
      )}
      <section className="pn-fold">
        <button className="pn-fold-h" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Settings2 aria-hidden /><span className="pn-fold-t"><b>Panel settings</b><small>{panelSummary(panel)}</small></span>{open ? <ChevronDown aria-hidden className="pn-fold-chev" /> : <ChevronRight aria-hidden className="pn-fold-chev" />}
        </button>
        {open && <div className="pn-fold-b"><PanelFields panel={panel} onChange={setPanel} /></div>}
      </section>
      <Button size="sm" icon={attached ? Check : Zap} active={attached} onClick={() => patchQuery({ power: attached ? null : { ...panel } })}
        title="Adds this panel to the search so Energy and Battery needed can be used as filters or objectives">
        {attached ? 'Used in search' : 'Use this panel in search'}
      </Button>
      <p className="pn-hint">Energy = 1361 W/m{'²'} {'×'} area {'×'} efficiency {'×'} Sun visibility {'×'} incidence. With the panel in the search, add an {'“'}Energy{'”'} or {'“'}Battery needed{'”'} filter or objective.</p>
    </div>
  );
}

function PowerSpark({ res, win, cursor, panel }: { res: PowerResult; win: [number, number]; cursor: number; panel: Panel }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 340, H = 56;
  const theme = useTheme();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    const P = palette();
    g.fillStyle = P.laneBg; g.fillRect(0, 0, W, H);
    const n = res.powerW.length;
    if (n < 2) return;
    let max = 1;
    for (let i = 0; i < n; i++) if (res.powerW[i] > max) max = res.powerW[i];
    max = Math.max(max, panel.loadW);
    const x = (t: number) => ((t - win[0]) / (win[1] - win[0])) * W;
    // dark stretches (no power) tinted
    g.fillStyle = theme === 'dark' ? '#000' : P.text; g.globalAlpha = theme === 'dark' ? 0.4 : 0.1;
    let run = -1;
    for (let i = 0; i <= n; i++) {
      const dark = i < n && res.powerW[i] <= 0;
      if (dark && run < 0) run = i;
      if (!dark && run >= 0) { g.fillRect(x(res.t[run]), 0, Math.max(1, x(res.t[Math.min(i, n - 1)]) - x(res.t[run])), H); run = -1; }
    }
    g.globalAlpha = 1;
    // power curve, max-per-pixel envelope
    g.fillStyle = P.sun;
    const colMax = new Float32Array(W);
    for (let i = 0; i < n; i++) { const c0 = Math.min(W - 1, Math.max(0, Math.floor(x(res.t[i])))); if (res.powerW[i] > colMax[c0]) colMax[c0] = res.powerW[i]; }
    for (let c0 = 0; c0 < W; c0++) { const h = (colMax[c0] / max) * (H - 6); if (h > 0) g.fillRect(c0, H - 2 - h, 1, h); }
    // load line
    g.strokeStyle = P.danger; g.lineWidth = 1.2; g.setLineDash([3, 3]);
    const ly = H - 2 - (panel.loadW / max) * (H - 6);
    g.beginPath(); g.moveTo(0, ly); g.lineTo(W, ly); g.stroke(); g.setLineDash([]);
    if (cursor >= win[0] && cursor <= win[1]) { g.strokeStyle = P.cursor; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x(cursor) + 0.5, 0); g.lineTo(x(cursor) + 0.5, H); g.stroke(); }
  }, [res, win, cursor, panel.loadW, theme]);
  let peak = 0;
  for (let i = 0; i < Math.min(res.powerW.length, 20000); i++) if (res.powerW[i] > peak) peak = res.powerW[i];
  return (
    <div className="pn-spark">
      <canvas ref={ref} aria-label="Panel power over the window" />
      <p className="pn-keys"><span><i className="ui-dot ui-dot--sun" />Panel power (peak {Math.round(peak)} W)</span><span><i className="pn-dash" />Load {panel.loadW} W</span><span><i className="pn-shade" />Dark</span></p>
    </div>
  );
}
