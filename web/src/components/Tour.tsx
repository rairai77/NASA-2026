import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Compass, ShieldCheck, X } from 'lucide-react';
import { TOUR } from '../lib/educatorText.ts';
import { flyTo, select, setCursor, useStore, windowOf } from '../store.ts';
import { Button, IconButton } from './ui.tsx';

/** What each tour step points at: a stable data-tour attribute first, then the legacy container as a fallback. */
const TARGETS: Record<string, { sel: string[]; phone?: 'results' | 'site' | 'timeline' }> = {
  apollo: { sel: ['[data-tour="sky"]', '[data-tour="inspector"]', '.drawer'], phone: 'site' },
  pole: { sel: ['[data-tour="sky"]', '[data-tour="inspector"]', '.drawer'], phone: 'site' },
  scrub: { sel: ['[data-tour="timeline"]', '.timeline'], phone: 'timeline' },
  ask: { sel: ['[data-tour="ask"]', '.ask'] },
  stand: { sel: ['[data-tour="stand"]', '[data-tour="inspector"]', '.drawer'], phone: 'site' },
};

function findTarget(act: string): HTMLElement | null {
  for (const s of TARGETS[act]?.sel ?? []) {
    const el = document.querySelector(s) as HTMLElement | null;
    if (el && el.getBoundingClientRect().width > 0) return el;
  }
  return null;
}

export function Tour() {
  const step = useStore((s) => s.tourStep);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step === null) return;
    const s = useStore.getState();
    const act = TOUR[step].action;
    useStore.setState({ playing: false, fpOpen: false });
    const pick = (ids: string[]) => ids.find((i) => s.targets[i]);
    if (act === 'apollo') { const id = pick(['apollo11']); if (id) { select(id); flyTo(id); } }
    if (act === 'pole') { const id = pick(['art3_malapert_massif', 'art3_haworth', 'art3_slater_plain']) ?? s.results?.results[0]?.id; if (id) { select(id); flyTo(id); } }
    if (act === 'scrub') { const [a, b] = windowOf(s.query); setCursor(a); useStore.setState({ speed: 86400 * 0.5, playing: true, playUntil: b }); }
    if (act === 'ask') (document.querySelector('.qtext') as HTMLInputElement | null)?.focus();
    if (act === 'stand') useStore.setState({ fpOpen: true });
    const ph = TARGETS[act]?.phone;
    if (ph && window.matchMedia('(max-width: 899px)').matches) useStore.setState({ phoneTab: ph });
  }, [step]);

  // follow the target element (it moves with layout, selection and the phone sheet)
  useLayoutEffect(() => {
    if (step === null) { setRect(null); return; }
    const act = TOUR[step].action;
    const measure = () => {
      const el = findTarget(act);
      const r = el?.getBoundingClientRect() ?? null;
      setRect((p) => (p && r && Math.abs(p.x - r.x) < 1 && Math.abs(p.y - r.y) < 1 && Math.abs(p.width - r.width) < 1 && Math.abs(p.height - r.height) < 1 ? p : r));
    };
    measure();
    const id = setInterval(measure, 300);
    window.addEventListener('resize', measure);
    return () => { clearInterval(id); window.removeEventListener('resize', measure); };
  }, [step]);

  // Escape ends the tour
  useEffect(() => {
    if (step === null) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') useStore.setState({ tourStep: null, playing: false }); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [step]);

  if (step === null) return null;
  const t = TOUR[step];
  const set = (n: number | null) => useStore.setState({ tourStep: n, playing: n === null ? false : useStore.getState().playing });
  const vh = window.innerHeight;
  // keep the card away from what it points at: target low on screen -> card at the top, else at the bottom
  const low = rect ? rect.y + rect.height / 2 > vh * 0.55 : false;
  const ring = rect;
  return (
    <>
      {ring && <div className="tour-ring" style={{ left: ring.x - 4, top: ring.y - 4, width: ring.width + 8, height: ring.height + 8 }} aria-hidden />}
      <div ref={cardRef} className={`tourcard ${low ? 'top' : 'bottom'}`} role="dialog" aria-label="Guided tour">
        <div className="tour-head">
          <span className="tour-kicker"><Compass aria-hidden />Guided tour</span>
          <span className="tour-dots" aria-label={`Step ${step + 1} of ${TOUR.length}`}>{TOUR.map((_, i) => <i key={i} className={i === step ? 'on' : i < step ? 'past' : ''} />)}</span>
          <IconButton icon={X} label="End tour" size="sm" tip="none" onClick={() => set(null)} />
        </div>
        <h4>{t.title.replace(/^\d+\.\s*/, '')}</h4>
        <p>{t.text}</p>
        <div className="tour-foot">
          <Button variant="ghost" size="sm" onClick={() => set(null)}>End tour</Button>
          <span className="tour-nav">
            <Button size="sm" icon={ChevronLeft} disabled={step === 0} onClick={() => set(step - 1)}>Back</Button>
            {step < TOUR.length - 1
              ? <Button variant="primary" size="sm" iconRight={ChevronRight} onClick={() => set(step + 1)}>Next</Button>
              : <Button variant="primary" size="sm" icon={ShieldCheck} onClick={() => { useStore.setState({ tourStep: null, fpOpen: false, validationOpen: true }); }}>Open {'“'}How we know{'”'}</Button>}
          </span>
        </div>
      </div>
    </>
  );
}
