import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store.ts';

export const WHY: Record<string, string> = {
  pole: 'Near the poles the Sun never climbs more than ~1.5° above the horizon. It skims along the skyline, so a ridge a few kilometres away can hide it for days, and the same spot can be in sunlight a few hundred metres away.',
  libration: 'Earth does not hang still in the lunar sky: the Moon’s tilt and slightly oval orbit make Earth wobble by about ±7° over 27.3 days (libration). Near the limb that wobble moves Earth above or below the horizon.',
  charging: 'Close to the day/night boundary the Sun is low and the ground can charge up unevenly, lofting electrically charged dust. Landers and rovers need to plan for stronger surface charging there.',
  scarps: 'Lobate scarps are cliffs formed as the Moon’s interior cooled and shrank. They are geologically young, and can still produce moonquakes, so we keep landing sites away from them.',
  horizon: 'The skyline is built from terrain heights measured by the LOLA laser altimeter. Anything the Sun or Earth sits behind is in shadow or out of line of sight.',
  eclipse: 'An eclipse here means Earth passes in front of the Sun as seen from the surface (a lunar solar eclipse).',
};

export function Why({ id }: { id: keyof typeof WHY }) {
  const educator = useStore((s) => s.educator);
  if (!educator) return null;
  return (
    <span className="why" tabIndex={0} aria-label={`Why? ${WHY[id]}`}>
      ?<span className="why-tip" role="tooltip">{WHY[id]}</span>
    </span>
  );
}

export function NumInput({ value, onChange, step, min, max, width = 72, ...rest }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; width?: number; 'aria-label'?: string;
}) {
  const [txt, setTxt] = useState(String(value));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { setTxt(String(value)); last.current = value; } }, [value]);
  return (
    <input
      className="num" style={{ width }} type="number" inputMode="decimal" value={txt} step={step} min={min} max={max}
      aria-label={rest['aria-label']}
      onChange={(e) => {
        setTxt(e.target.value);
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) { last.current = v; onChange(v); }
      }}
    />
  );
}

export function Popover({ trigger, children, className = '', onToggle }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: ReactNode; className?: string; onToggle?: (o: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); onToggle?.(false); } };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); onToggle?.(false); } };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open, onToggle]);
  return (
    <span className={`popwrap ${className}`} ref={ref}>
      {trigger(open, () => { setOpen(!open); onToggle?.(!open); })}
      {open && <div className="pop" role="dialog">{children}</div>}
    </span>
  );
}

export function Badge({ children, tone = '', title }: { children: ReactNode; tone?: string; title?: string }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}

export function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  return <div className="toast" role="status" key={t.id}>{t.msg}</div>;
}

export function useEscape(active: boolean, fn: () => void) {
  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') fn(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [active, fn]);
}
