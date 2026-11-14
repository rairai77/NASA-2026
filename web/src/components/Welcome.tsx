import { useEffect } from 'react';
import { Check, Compass, ShieldCheck, X } from 'lucide-react';
import { parseText, useStore } from '../store.ts';
import { EXAMPLE_LIST } from './QueryBar.tsx';
import { Button, IconButton, Spinner } from './ui.tsx';
import { useBootSteps } from './Splash.tsx';

const KEY = 'llsn.welcome.v1';

function runWhenReady(fn: () => void) {
  const s = useStore.getState();
  if (s.info && s.sites.length) { fn(); return; }
  const un = useStore.subscribe((st) => { if (st.info && st.sites.length) { un(); fn(); } });
}

export function dismissWelcome() {
  try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
  useStore.setState({ welcomeOpen: false });
}

/** First-visit card over the globe: what the app does, three one-click questions, the tour. */
export function Welcome() {
  const open = useStore((s) => s.welcomeOpen);
  const { ready } = useBootSteps();
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') dismissWelcome(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  if (!open) return null;
  return (
    <div className="welcome-back" onMouseDown={(e) => { if (e.target === e.currentTarget) dismissWelcome(); }}>
      <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-h">
        <span className="welcome-x"><IconButton icon={X} label="Close" tip="left" onClick={dismissWelcome} /></span>
        <span className="welcome-logo" aria-hidden />
        <h1 id="welcome-h">Where on the Moon do the Sun and Earth stay up?</h1>
        <p className="welcome-lead">Landers need sunlight for power and a line of sight to Earth for radio. At the lunar poles both depend on mountains and crater rims, so we compute it from real terrain and ephemerides.</p>
        <p className="welcome-lead">Ask a question in plain words, or build one with chips, and get ranked sites you can inspect, check against real missions and stand on.</p>
        <div className="welcome-ex" role="group" aria-label="Example questions">
          {EXAMPLE_LIST.slice(0, 3).map((e) => (
            <button key={e.label} className="welcome-card" onClick={() => { dismissWelcome(); runWhenReady(() => parseText(e.text)); }}>
              <e.icon aria-hidden /><b>{e.label}</b><small>{e.sub}</small>
            </button>
          ))}
        </div>
        <div className="welcome-actions">
          <Button variant="primary" size="lg" icon={Compass} onClick={() => { dismissWelcome(); runWhenReady(() => useStore.setState({ tourStep: 0 })); }}>Take the 60-second tour</Button>
          <Button size="lg" onClick={dismissWelcome}>Explore on my own</Button>
        </div>
        <button className="welcome-link" onClick={() => { dismissWelcome(); useStore.setState({ validationOpen: true }); }}><ShieldCheck aria-hidden />How we know it{'’'}s right</button>
        <div className="welcome-status" aria-live="polite">{ready ? <><Check aria-hidden />Ready</> : <><Spinner />Loading the Moon in the background{'…'}</>}</div>
      </div>
    </div>
  );
}
