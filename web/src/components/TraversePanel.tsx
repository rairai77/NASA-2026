// "Plan a traverse": selected site = start; goal picked on the globe or from a site list; path drawn by globe/traverseLayer.ts.
import { useMemo } from 'react';
import { fmtDur } from '../lib/time.ts';
import { DEFAULT_LIMITS, clearTraverse, runTraverse, setTraverse, useStore, type Target } from '../store.ts';
import { NumInput } from './ui.tsx';

const R_KM = 1737.4;
function distKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

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
  const dist = goal ? distKm(target, goal) : 0;

  const status = result && (
    result.status === 'ok'
      ? null
      : result.status === 'no_path'
        ? `No route: every path to the goal crosses ground steeper than ${limits.maxSlopeDeg}° (or the goal is on a slope that steep). Try raising the slope limit${limits.maxSlopeDeg < 30 ? ` (for example to ${Math.min(35, limits.maxSlopeDeg + 5)}°)` : ''}, or pick a goal on gentler ground.`
        : `Timed out: the rover cannot get there within ${limits.maxHours} h at ${limits.speedMps} m/s${limits.requireSun ? ' while staying in sunlight (it waits out the dark)' : ''}${limits.requireEarth ? ' and in Earth view' : ''}. Raise the time budget, relax the Sun/Earth requirement, or choose a closer goal.`
  );

  return (
    <section className="traverse">
      <h3>Plan a traverse</h3>
      <p className="hint">Start: <b>{target.name}</b>. Departs at the timeline cursor ({new Date(cursor * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC).</p>
      <div className="row">
        <button className={`btn sm ${picking ? 'on' : ''}`} onClick={() => setTraverse({ picking: !picking })}>{picking ? 'Click the globe…' : 'Pick goal on globe'}</button>
        <select aria-label="Goal site" value="" onChange={(e) => {
          const id = e.target.value; if (!id) return;
          const t = targets[id]; if (t) setTraverse({ goal: { lat: t.lat, lon: t.lon, name: t.name }, picking: false, result: null, error: null });
        }}>
          <option value="">Goal: another site…</option>
          {options.ranked.length > 0 && <optgroup label="Ranked results">{options.ranked.map((t) => <option key={t.id} value={t.id}>#{t.rank} {t.name}</option>)}</optgroup>}
          <optgroup label="Curated sites">{options.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
        </select>
        {goal && <button className="icon-btn" aria-label="Clear goal" onClick={clearTraverse}>{'×'}</button>}
      </div>
      {goal && <p className="coords">Goal {goal.name ? `${goal.name} · ` : ''}{goal.lat.toFixed(4)}{'°'}, {goal.lon.toFixed(4)}{'°'} <span>{dist.toFixed(2)} km straight line</span></p>}
      {goal && dist > 15 && <p className="hint warnline">The planner grid is limited to about 15 km; a goal this far may fail.</p>}
      <div className="grid4">
        <label>Max slope ({'°'})<NumInput value={limits.maxSlopeDeg} min={1} max={45} width={64} onChange={(v) => setLim({ maxSlopeDeg: v })} /></label>
        <label>Speed (m/s)<NumInput value={limits.speedMps} min={0.005} step={0.01} width={64} onChange={(v) => v > 0 && setLim({ speedMps: v })} /></label>
        <label>Max hours<NumInput value={limits.maxHours} min={1} step={6} width={64} onChange={(v) => setLim({ maxHours: v })} /></label>
        <div className="checks">
          <label className="check"><input type="checkbox" checked={limits.requireSun} onChange={(e) => setLim({ requireSun: e.target.checked })} />Stay in sunlight</label>
          <label className="check"><input type="checkbox" checked={limits.requireEarth} onChange={(e) => setLim({ requireEarth: e.target.checked })} />Stay in Earth view</label>
        </div>
      </div>
      <div className="row">
        <button className="btn primary" disabled={!goal || busy} onClick={runTraverse}>{busy ? 'Planning…' : 'Plan traverse'}</button>
        <button className="btn sm ghost" onClick={() => setTraverse({ limits: { ...DEFAULT_LIMITS } })}>Reset limits</button>
      </div>
      {error && <p className="err">{error}</p>}
      {result && (
        <>
          <div className={`verdict ${result.status === 'ok' ? 'yes' : 'no'}`} role="status">
            {result.status === 'ok' ? '✔ Route found' : result.status === 'no_path' ? '✖ No path' : '✖ Timed out'}
            {status && <small>{status}</small>}
          </div>
          {result.status === 'ok' && (
            <table className="mtable">
              <tbody>
                <tr><th>Distance along path</th><td>{fmtDist(result.distanceM)}</td></tr>
                <tr><th>Duration</th><td>{fmtDur(result.durationS)}</td></tr>
                <tr><th>Time in sunlight</th><td>{Math.round(result.sunlitFrac * 100)}%</td></tr>
                <tr><th>Time with Earth in view</th><td>{Math.round(result.earthFrac * 100)}%</td></tr>
                <tr><th>Planner cell</th><td>{result.cellM} m</td></tr>
              </tbody>
            </table>
          )}
          {result.status === 'no_path' && limits.maxSlopeDeg < 35 && (
            <button className="btn sm" onClick={() => { setLim({ maxSlopeDeg: Math.min(35, limits.maxSlopeDeg + 5) }); setTimeout(runTraverse, 0); }}>Retry with {Math.min(35, limits.maxSlopeDeg + 5)}{'°'}</button>
          )}
        </>
      )}
    </section>
  );
}
