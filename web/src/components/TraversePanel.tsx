// "Plan a traverse": selected site = start; goal picked on the globe or from a site list; path drawn by globe/traverseLayer.ts.
import { useMemo } from 'react';
import { CircleCheck, CircleX, Flag, MousePointerClick, Route, RotateCcw, X } from 'lucide-react';
import { greatCircleKm } from '../lib/places.ts';
import { fmtDur } from '../lib/time.ts';
import { DEFAULT_LIMITS, clearTraverse, runTraverse, setTraverse, useStore, type Target } from '../store.ts';
import { Button, IconButton, NumInput, Stat } from './ui.tsx';

const fmtDist = (m: number) => (m >= 1000 ? { v: (m / 1000).toFixed(2), u: 'km' } : { v: String(Math.round(m)), u: 'm' });

export function TraversePanel({ target }: { target: Target }) {
  const tr = useStore((s) => s.traverse);
  const targets = useStore((s) => s.targets);
  const sites = useStore((s) => s.sites);
  const cursor = useStore((s) => s.cursor);
  const { goal, limits, busy, result, error, picking } = tr;
  const options = useMemo(() => {
    const ranked = Object.values(targets).filter((t) => t.kind === 'result' && t.id !== target.id).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    return { ranked, sites: sites.filter((s) => s.id !== target.id) };
  }, [targets, sites, target.id]);
  const setLim = (p: Partial<typeof limits>) => setTraverse({ limits: { ...limits, ...p } });
  const dist = goal ? greatCircleKm(target, goal) : 0;

  const status = result && (
    result.status === 'ok'
      ? null
      : result.status === 'no_path'
        ? `No route: every path to the goal crosses ground steeper than ${limits.maxSlopeDeg}° (or the goal is on a slope that steep). Try raising the slope limit${limits.maxSlopeDeg < 30 ? ` (for example to ${Math.min(35, limits.maxSlopeDeg + 5)}°)` : ''}, or pick a goal on gentler ground.`
        : `Timed out: the rover cannot get there within ${limits.maxHours} h at ${limits.speedMps} m/s${limits.requireSun ? ' while staying in sunlight (it waits out the dark)' : ''}${limits.requireEarth ? ' and in Earth view' : ''}. Raise the time budget, relax the Sun/Earth requirement, or choose a closer goal.`
  );
  const dd = result?.status === 'ok' ? fmtDist(result.distanceM) : null;

  return (
    <div className="pn-pane traverse">
      <p className="pn-hint">Start: <b>{target.name}</b>. Departs at the timeline cursor (<span className="mono">{new Date(cursor * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC</span>).</p>

      <section className="pn-step">
        <h3 className="ui-section-title">1 {'·'} Goal</h3>
        <div className="pn-goal-row">
          <Button size="sm" icon={MousePointerClick} active={picking} onClick={() => setTraverse({ picking: !picking })}>{picking ? 'Click the globe…' : 'Pick on globe'}</Button>
          <select aria-label="Goal site" value="" onChange={(e) => {
            const id = e.target.value; if (!id) return;
            const t = targets[id]; if (t) setTraverse({ goal: { lat: t.lat, lon: t.lon, name: t.name }, picking: false, result: null, error: null });
          }}>
            <option value="">Another site…</option>
            {options.ranked.length > 0 && <optgroup label="Ranked results">{options.ranked.map((t) => <option key={t.id} value={t.id}>#{t.rank} {t.name}</option>)}</optgroup>}
            <optgroup label="Curated sites">{options.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
          </select>
        </div>
        {goal && (
          <div className="pn-goal">
            <Flag aria-hidden />
            <div><b>{goal.name ?? 'Goal point'}</b><span className="mono">{goal.lat.toFixed(4)}{'°'}, {goal.lon.toFixed(4)}{'°'} {'·'} {dist.toFixed(2)} km straight line</span></div>
            <IconButton icon={X} label="Clear goal" size="sm" tip="left" onClick={clearTraverse} />
          </div>
        )}
        {goal && dist > 15 && <p className="pn-note warn">The planner grid is limited to about 15 km; a goal this far may fail.</p>}
      </section>

      <section className="pn-step">
        <h3 className="ui-section-title">2 {'·'} Limits</h3>
        <div className="pn-limits">
          <label>Max slope ({'°'})<NumInput value={limits.maxSlopeDeg} min={1} max={45} width={64} onChange={(v) => setLim({ maxSlopeDeg: v })} /></label>
          <label>Speed (m/s)<NumInput value={limits.speedMps} min={0.005} step={0.01} width={64} onChange={(v) => v > 0 && setLim({ speedMps: v })} /></label>
          <label>Max hours<NumInput value={limits.maxHours} min={1} step={6} width={64} onChange={(v) => setLim({ maxHours: v })} /></label>
        </div>
        <div className="pn-checks">
          <label className="pn-check"><input type="checkbox" checked={limits.requireSun} onChange={(e) => setLim({ requireSun: e.target.checked })} />Stay in sunlight</label>
          <label className="pn-check"><input type="checkbox" checked={limits.requireEarth} onChange={(e) => setLim({ requireEarth: e.target.checked })} />Stay in Earth view</label>
        </div>
      </section>

      <div className="pn-btns">
        <Button variant="primary" icon={Route} disabled={!goal || busy} onClick={runTraverse}>{busy ? 'Planning…' : 'Plan traverse'}</Button>
        <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => setTraverse({ limits: { ...DEFAULT_LIMITS } })}>Reset limits</Button>
      </div>
      {error && <p className="pn-err">{error}</p>}
      {result && (
        <>
          <div className={`pn-verdict ${result.status === 'ok' ? 'yes' : 'no'}`} role="status">
            {result.status === 'ok' ? <CircleCheck aria-hidden /> : <CircleX aria-hidden />}
            <div>
              <b>{result.status === 'ok' ? 'Route found' : result.status === 'no_path' ? 'No path' : 'Timed out'}</b>
              {status && <small>{status}</small>}
            </div>
          </div>
          {result.status === 'ok' && dd && (
            <>
              <div className="pn-stats pn-stats--4">
                <Stat label="Distance" value={dd.v} unit={dd.u} title="Distance along path" />
                <Stat label="Duration" value={fmtDur(result.durationS)} title="Duration" />
                <Stat label="In sunlight" value={Math.round(result.sunlitFrac * 100)} unit="%" tone="sun" title="Time in sunlight" />
                <Stat label="Earth view" value={Math.round(result.earthFrac * 100)} unit="%" tone="earth" title="Time with Earth in view" />
              </div>
              <p className="pn-small">Planner cell <span className="mono">{result.cellM} m</span></p>
            </>
          )}
          {result.status === 'no_path' && limits.maxSlopeDeg < 35 && (
            <Button size="sm" onClick={() => { setLim({ maxSlopeDeg: Math.min(35, limits.maxSlopeDeg + 5) }); setTimeout(runTraverse, 0); }}>Retry with {Math.min(35, limits.maxSlopeDeg + 5)}{'°'}</Button>
          )}
        </>
      )}
    </div>
  );
}
