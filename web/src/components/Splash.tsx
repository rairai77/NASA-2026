import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { useStore } from '../store.ts';

export interface BootStep { label: string; done: boolean; active: boolean; detail?: string }

/** Boot progress derived from the store (engine init, data catalogs, first ranking). */
export function useBootSteps(): { steps: BootStep[]; ready: boolean; pct: number } {
  const info = useStore((s) => s.info);
  const sitesN = useStore((s) => s.sites.length);
  const results = useStore((s) => s.results);
  const ranking = useStore((s) => s.ranking);
  const progress = useStore((s) => s.progress);
  const ready = results !== null;
  const eph = info !== null, terr = eph && sitesN > 0, idx = terr && (ranking || ready);
  const pct = ready ? 1 : progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
  const flags = [eph, terr, idx, ready];
  const first = flags.findIndex((f) => !f);
  const steps: BootStep[] = [
    { label: 'Ephemeris', detail: 'Sun and Earth positions' },
    { label: 'Terrain', detail: 'LOLA horizon engine' },
    { label: 'Region index', detail: 'Polar cell grid' },
    { label: 'Ranking 72,324 cells', detail: progress && !ready ? `${progress.stage} ${Math.round(pct * 100)}%` : undefined },
  ].map((s, i) => ({ ...s, done: flags[i], active: i === first }));
  return { steps, ready, pct };
}

/** Covers the globe area until the engine is initialised and the first ranking has arrived. Never blocks for more than 45 s. */
export function Splash() {
  const { steps, ready } = useBootSteps();
  const welcome = useStore((s) => s.welcomeOpen);
  const [failed, setFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [phase, setPhase] = useState<'show' | 'fade' | 'gone'>('show');
  const started = useStore((s) => s.ranking);
  const [wasRanking, setWasRanking] = useState(false);

  useEffect(() => { const id = setTimeout(() => setTimedOut(true), 45000); return () => clearTimeout(id); }, []);
  useEffect(() => { if (started) setWasRanking(true); }, [started]);
  // ranking ended without results = error
  useEffect(() => { if (wasRanking && !started && !ready) setFailed(true); }, [wasRanking, started, ready]);
  useEffect(() => useStore.subscribe((s) => { if (s.toast && /failed|unavailable/i.test(s.toast.msg)) setFailed(true); }), []);

  const done = ready || failed || timedOut;
  useEffect(() => {
    if (!done) return;
    setPhase('fade');
    const id = setTimeout(() => setPhase('gone'), 700);
    return () => clearTimeout(id);
  }, [done]);

  if (phase === 'gone') return null;
  return (
    <div className={`splash ${phase === 'fade' ? 'out' : ''} ${welcome ? 'quiet' : ''}`} role="status" aria-live="polite" aria-label="Loading the Moon">
      <div className="splash-in">
        <span className="splash-logo" aria-hidden />
        <h2>Lunar Landing Site Navigator</h2>
        <p>Preparing the Moon{'…'}</p>
        <ol className="splash-steps">
          {steps.map((s) => (
            <li key={s.label} className={s.done ? 'done' : s.active ? 'active' : ''}>
              <i aria-hidden>{s.done ? <Check /> : s.active ? <span className="ui-spinner" /> : null}</i>
              <span>{s.label}</span>{s.detail && <small>{s.detail}</small>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
