import { useEffect } from 'react';
import { TOUR } from '../lib/educatorText.ts';
import { flyTo, select, setCursor, useStore, windowOf } from '../store.ts';

export function Tour() {
  const step = useStore((s) => s.tourStep);
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
  }, [step]);
  if (step === null) return null;
  const t = TOUR[step];
  const set = (n: number | null) => useStore.setState({ tourStep: n, playing: n === null ? false : useStore.getState().playing });
  return (
    <div className="tour" role="dialog" aria-label="Guided tour">
      <h4>Guided tour {'·'} {step + 1} / {TOUR.length}</h4>
      <p><b>{t.title}.</b> {t.text}</p>
      <div className="row">
        <button className="btn sm ghost" onClick={() => set(null)}>End tour</button>
        <span className="row">
          <button className="btn sm" disabled={step === 0} onClick={() => set(step - 1)}>Back</button>
          {step < TOUR.length - 1
            ? <button className="btn sm primary" onClick={() => set(step + 1)}>Next</button>
            : <button className="btn sm primary" onClick={() => { useStore.setState({ tourStep: null, fpOpen: false, validationOpen: true }); }}>Open &ldquo;How we know&rdquo;</button>}
        </span>
      </div>
    </div>
  );
}
