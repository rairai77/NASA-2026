// "Plan a traverse": selected site = start; goal picked on the globe or from a site list; path drawn by globe/traverseLayer.ts.
import { useEffect, useMemo, useRef } from 'react';
import { CircleAlert, CircleCheck, CircleX, Flag, MousePointerClick, Route, RotateCcw, X } from 'lucide-react';
import { greatCircleKm, placeFor } from '../lib/places.ts';
import { fmtDur } from '../lib/time.ts';
import { DEFAULT_LIMITS, clearTraverse, runTraverse, setTraverse, useStore, type Target } from '../store.ts';
import { Button, IconButton, NumInput, Stat } from './ui.tsx';
import { useCurrentRanks } from './LeftPanel.tsx';

const PLANNER_KM = 15;
const fmtDist = (m: number) => (m >= 1000 ? { v: (m / 1000).toFixed(2), u: 'km' } : { v: String(Math.round(m)), u: 'm' });

export function TraversePanel({ target }: { target: Target }) {
  const tr = useStore((s) => s.traverse);
  const targets = useStore((s) => s.targets);
  const sites = useStore((s) => s.sites);
  const cursor = useStore((s) => s.cursor);
  const { goal, limits, busy, result, error, picking } = tr;
  const ranks = useCurrentRanks();
  // goals: only places the planner can reach (within ~15 km of the start), nearest first; ranked results show their rank
  const options = useMemo(() => {
    const nameOf = (t: Target) => (t.kind === 'result' ? placeFor(t.lat, t.lon, sites).title : t.name);
    const list: { id: string; label: string; km: number }[] = [];
    for (const s of sites) {
      if (s.id === target.id) continue;
      const km = greatCircleKm(target, s);
      if (km <= PLANNER_KM) list.push({ id: s.id, label: s.name, km });
    }
    for (const [id, rank] of ranks) {
      if (id === target.id || !targets[id] || sites.some((s) => s.id === id)) continue;
      const km = greatCircleKm(target, targets[id]);
      if (km <= PLANNER_KM) list.push({ id, label: `#${rank} ${nameOf(targets[id])}`, km });
    }
    return { goals: list.sort((a, b) => a.km - b.km), nameOf };
  }, [targets, sites, target, ranks]);
  const startName = target.kind === 'result' ? placeFor(target.lat, target.lon, sites).title : target.name;
  const setLim = (p: Partial<typeof limits>) => setTraverse({ limits: { ...limits, ...p } });
  const dist = goal ? greatCircleKm(target, goal) : 0;

  const status = result && (
    result.status === 'ok'
      ? null
      : result.status === 'no_path'
        ? `No route: every path to the goal crosses ground steeper than ${limits.maxSlopeDeg}° (or the goal is on a slope that steep). Try raising the slope limit${limits.maxSlopeDeg < 30 ? ` (for example to ${Math.min(35, limits.maxSlopeDeg + 5)}°)` : ''}, or pick a goal on gentler ground.`
        : `The rover cannot get there within ${limits.maxHours} h at ${limits.speedMps} m/s${limits.requireSun ? ' while staying in sunlight (it waits out the dark)' : ''}${limits.requireEarth ? ' and in Earth view' : ''}. Raise the time budget, relax the Sun/Earth requirement, or choose a closer goal.`
  );
  const dd = result?.status === 'ok' ? fmtDist(result.distanceM) : null;

  // when a result or an error appears, scroll it into view inside the inspector's scroll container and move focus to it
  const resRef = useRef<HTMLDivElement>(null);
  const seen = useRef<unknown>(result || error ? 'init' : null);
  useEffect(() => {
    const key = result ?? error;
    if (!key || key === seen.current) { if (!key) seen.current = null; return; }
    seen.current = key;
    const el = resRef.current, box = el?.closest('.pn-scroll') as HTMLElement | null;
    if (!el || !box) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const go = () => {
      const cr = box.getBoundingClientRect(), er = el.getBoundingClientRect();
      const top = cr.top + 52; // sticky tab bar
      let delta = 0;
      if (er.top < top) delta = er.top - top - 8;
      else if (er.bottom > cr.bottom - 8) delta = Math.min(er.bottom - cr.bottom + 16, er.top - top - 8);
      if (delta) box.scrollBy({ top: delta, behavior: reduce ? 'auto' : 'smooth' });
      el.focus({ preventScroll: true });
    };
    requestAnimationFrame(go);
  }, [result, error]);

  return (
    <div className="pn-pane pn-trv">
      <p className="pn-hint">Start: <b>{startName}</b>, departing at the timeline cursor (<span className="mono">{new Date(cursor * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC</span>).</p>

      {goal ? (
        <div className="pn-goal">
          <Flag aria-hidden />
          <div><b>{goal.name ?? 'Goal point'}</b><span className="mono">{goal.lat.toFixed(4)}{'°'}, {goal.lon.toFixed(4)}{'°'} {'·'} {dist.toFixed(2)} km straight line</span></div>
          <IconButton icon={X} label="Clear goal" size="sm" tip="left" onClick={clearTraverse} />
        </div>
      ) : (
        <div className="pn-goal-row">
          <Button size="sm" variant={options.goals.length ? undefined : 'primary'} icon={MousePointerClick} active={picking} onClick={() => setTraverse({ picking: !picking })}>{picking ? 'Click the globe…' : 'Pick on globe'}</Button>
          {options.goals.length > 0
            ? <select aria-label="Goal site" value="" onChange={(e) => {
            const id = e.target.value; if (!id) return;
            const t = targets[id]; if (t) setTraverse({ goal: { lat: t.lat, lon: t.lon, name: options.nameOf(t) }, picking: false, result: null, error: null });
          }}>
            <option value="">Goal within 15 km…</option>
            {options.goals.map((g) => <option key={g.id} value={g.id}>{g.label} {'·'} {g.km.toFixed(1)} km</option>)}
          </select>
            : <p className="pn-hint">No known sites within 15 km of here. Click the globe to choose a goal point.</p>}
        </div>
      )}
      {goal && dist > 15 && <p className="pn-note warn">The planner grid is limited to about 15 km; a goal this far may fail.</p>}

      <div className="pn-limits">
        <label>Max slope ({'°'})<NumInput value={limits.maxSlopeDeg} min={1} max={45} width={64} onChange={(v) => setLim({ maxSlopeDeg: v })} /></label>
        <label>Speed (m/s)<NumInput value={limits.speedMps} min={0.005} step={0.01} width={64} onChange={(v) => v > 0 && setLim({ speedMps: v })} /></label>
        <label>Max hours<NumInput value={limits.maxHours} min={1} step={6} width={64} onChange={(v) => setLim({ maxHours: v })} /></label>
      </div>
      <div className="pn-trv-foot">
        <span className="pn-checks">
          <label className="pn-check"><input type="checkbox" checked={limits.requireSun} onChange={(e) => setLim({ requireSun: e.target.checked })} />Stay in sunlight</label>
          <label className="pn-check"><input type="checkbox" checked={limits.requireEarth} onChange={(e) => setLim({ requireEarth: e.target.checked })} />Stay in Earth view</label>
        </span>
        <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => setTraverse({ limits: { ...DEFAULT_LIMITS } })}>Reset</Button>
      </div>

      <Button variant="primary" icon={Route} disabled={!goal || busy} onClick={runTraverse}>{busy ? 'Planning…' : 'Plan traverse'}</Button>

      <div ref={resRef} tabIndex={-1} className="pn-trv-res" role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} aria-atomic="true">
        {error && <p className="pn-err-box"><CircleAlert aria-hidden />{error}</p>}
        {result && (
          <>
            <div className={`pn-verdict pn-verdict--row ${result.status === 'ok' ? 'yes' : 'no'}`}>
              {result.status === 'ok' ? <CircleCheck aria-hidden /> : <CircleX aria-hidden />}
              <div>
                <b>{result.status === 'ok' ? 'Route found' : result.status === 'no_path' ? 'No path' : 'Timed out'}</b>
                {status && <small>{status}</small>}
              </div>
            </div>
            {result.status === 'ok' && dd && (
              <>
                <div className="pn-stats pn-stats--4 pn-stats--flat">
                  <Stat label="Distance" value={dd.v} unit={dd.u} title="Distance along path" />
                  <Stat label="Duration" value={fmtDur(result.durationS)} title="Duration" />
                  <Stat label="In sunlight" value={Math.round(result.sunlitFrac * 100)} unit="%" tone="sun" title="Time in sunlight" />
                  <Stat label="Earth view" value={Math.round(result.earthFrac * 100)} unit="%" tone="earth" title="Time with Earth in view" />
                </div>
                <p className="pn-small">Planner cell <span className="mono">{Math.round(result.cellM)} m</span></p>
              </>
            )}
            {result.status === 'timeout' && limits.maxHours < 168 && (
              <Button size="sm" onClick={() => { setLim({ maxHours: 168 }); setTimeout(runTraverse, 0); }}>Retry with 168 h</Button>
            )}
            {result.status === 'no_path' && limits.maxSlopeDeg < 35 && (
              <Button size="sm" onClick={() => { setLim({ maxSlopeDeg: Math.min(35, limits.maxSlopeDeg + 5) }); setTimeout(runTraverse, 0); }}>Retry with {Math.min(35, limits.maxSlopeDeg + 5)}{'°'}</Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
