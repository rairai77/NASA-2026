import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Compass, ShieldCheck, X } from 'lucide-react';
import { TOUR } from '../lib/educatorText.ts';
import { flyTo, resultId, select, setCursor, useStore, windowOf } from '../store.ts';
import { Button, IconButton } from './ui.tsx';

/** What each tour step points at: a stable data-tour attribute first, then the legacy container as a fallback. */
const TARGETS: Record<string, { sel: string[]; phone?: 'results' | 'site' | 'timeline' }> = {
  answer: { sel: ['.pn-list .pn-card', '.pn-list > li'], phone: 'results' },
  why: { sel: ['[data-tour="sky"]', '[data-tour="inspector"]', '.drawer'], phone: 'site' },
  scrub: { sel: ['[data-tour="timeline"]', '.timeline'], phone: 'timeline' },
  stand: { sel: ['[data-tour="stand"]', '[data-tour="inspector"]', '.drawer'], phone: 'site' },
  how: { sel: ['[data-tour="how"]'] },
};
const isPhone = () => window.matchMedia('(max-width: 899px)').matches;

function findTarget(act: string): HTMLElement | null {
  for (const s of TARGETS[act]?.sel ?? []) {
    const el = document.querySelector(s) as HTMLElement | null;
    if (el && el.getBoundingClientRect().width > 0) return el;
  }
  return null;
}

type Pos = 'bottom' | 'top' | 'bottom-left' | 'bottom-right';

export function Tour() {
  const step = useStore((s) => s.tourStep);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<Pos>('bottom');
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step === null) return;
    const s = useStore.getState();
    const act = TOUR[step].action;
    useStore.setState({ playing: false, fpOpen: false, leftCollapsed: false, rightCollapsed: false, timelineCollapsed: false, ...(act === 'why' || act === 'stand' ? { inspectorTab: 'sky' as const } : {}), ...(act === 'answer' ? { leftTab: 'results' as const } : {}) });
    if (act === 'answer' || act === 'why' || act === 'stand') {
      const id = s.results?.results[0] ? (s.results.results[0].id ?? resultId(s.results.results[0].lat, s.results.results[0].lon)) : null;
      if (id && s.selected !== id) { select(id); flyTo(id); }
    }
    if (act === 'scrub') { const [a, b] = windowOf(s.query); setCursor(a); useStore.setState({ speed: 86400 * 0.5, playing: true, playUntil: b }); }
    const ph = TARGETS[act]?.phone;
    if (ph && isPhone()) useStore.setState({ phoneTab: ph });
  }, [step]);

  // follow the target element (it moves with layout, selection and the phone sheet); scroll it into view once it exists
  useLayoutEffect(() => {
    if (step === null) { setRect(null); return; }
    const act = TOUR[step].action;
    let scrolled = false;
    const measure = () => {
      const el = findTarget(act);
      if (el && !scrolled && act !== 'scrub') {
        scrolled = true;
        const h = el.getBoundingClientRect().height;
        el.scrollIntoView({ block: h > window.innerHeight * 0.5 ? 'start' : 'center', inline: 'nearest' });
      }
      const r = el?.getBoundingClientRect() ?? null;
      setRect((p) => (p && r && Math.abs(p.x - r.x) < 1 && Math.abs(p.y - r.y) < 1 && Math.abs(p.width - r.width) < 1 && Math.abs(p.height - r.height) < 1 ? p : r));
    };
    measure();
    const id = setInterval(measure, 300);
    window.addEventListener('resize', measure);
    return () => { clearInterval(id); window.removeEventListener('resize', measure); };
  }, [step]);

  // put the card where it does not cover its target
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (step === null || !card) return;
    const vw = window.innerWidth, vh = window.innerHeight, w = card.offsetWidth, h = card.offsetHeight;
    const cands: [Pos, number, number][] = [['bottom', (vw - w) / 2, vh - 200 - h], ['top', (vw - w) / 2, 112]];
    if (vw >= 900) cands.push(['bottom-left', 16, vh - 200 - h], ['bottom-right', vw - 16 - w, vh - 200 - h]);
    const overlap = (x: number, y: number) => {
      if (!rect) return 0;
      const ox = Math.min(x + w, rect.right + 8) - Math.max(x, rect.left - 8), oy = Math.min(y + h, rect.bottom + 8) - Math.max(y, rect.top - 8);
      return ox > 0 && oy > 0 ? ox * oy : 0;
    };
    let best = cands[0], bo = Infinity;
    for (const c of cands) { const o = overlap(c[1], c[2]); if (o < bo) { bo = o; best = c; } if (o === 0) break; }
    setPos((p) => (p === best[0] ? p : best[0]));
  }, [step, rect]);

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
  const ring = rect;
  const text = isPhone() && t.phoneText ? t.phoneText : t.text;
  return (
    <>
      {ring && <div className="tour-ring" style={{ left: ring.x - 4, top: ring.y - 4, width: ring.width + 8, height: ring.height + 8 }} aria-hidden />}
      <div ref={cardRef} className={`tourcard ${pos}`} role="dialog" aria-label="Guided tour">
        <div className="tour-head">
          <span className="tour-kicker"><Compass aria-hidden />Guided tour</span>
          <span className="tour-dots" aria-label={`Step ${step + 1} of ${TOUR.length}`}>{TOUR.map((_, i) => <i key={i} className={i === step ? 'on' : i < step ? 'past' : ''} />)}</span>
          <IconButton icon={X} label="End tour" size="sm" tip="none" onClick={() => set(null)} />
        </div>
        <h4>{t.title.replace(/^\d+\.\s*/, '')}</h4>
        <p>{text}</p>
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
