import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store.ts';
import { ALIASES, TIPS } from '../lib/educatorText.ts';

export const WHY = TIPS;

export function Why({ id }: { id: string }) {
  const educator = useStore((s) => s.educator);
  const key = ALIASES[id] ?? id;
  if (!educator || !WHY[key]) return null;
  return (
    <span className="why" tabIndex={0} aria-label={`Why? ${WHY[key]}`}>
      ?<span className="why-tip" role="tooltip">{WHY[key]}</span>
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

// ---- Design-system primitives (see docs/DESIGN.md, styles in src/design.css) ----------------------------
import type { ButtonHTMLAttributes, ComponentType, SVGProps } from 'react';
export type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; icon?: IconType; iconRight?: IconType; active?: boolean;
};
export function Button({ variant = 'secondary', size = 'md', icon: Ic, iconRight: IcR, active, className = '', children, type = 'button', ...rest }: BtnProps) {
  return (
    <button type={type} className={`ui-btn ui-btn--${variant} ${size !== 'md' ? `ui-btn--${size}` : ''} ${active ? 'is-active' : ''} ${className}`} aria-pressed={active} {...rest}>
      {Ic && <Ic aria-hidden />}{children}{IcR && <IcR aria-hidden />}
    </button>
  );
}

/** Icon-only button; `label` is the accessible name and the tooltip. */
export function IconButton({ icon: Ic, label, size = 'md', solid, active, tip = 'bottom', className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconType; label: string; size?: 'sm' | 'md'; solid?: boolean; active?: boolean; tip?: 'top' | 'bottom' | 'left' | 'right' | 'none';
}) {
  const btn = (
    <button type={type} aria-label={label} aria-pressed={active} className={`ui-icon-btn ${size === 'sm' ? 'ui-icon-btn--sm' : ''} ${solid ? 'ui-icon-btn--solid' : ''} ${active ? 'is-active' : ''} ${className}`} {...rest}>
      <Ic aria-hidden />
    </button>
  );
  if (tip === 'none') return btn;
  return <Tooltip content={label} side={tip}>{btn}</Tooltip>;
}

export function Tooltip({ content, side = 'top', wrap, children }: { content: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; wrap?: boolean; children: ReactNode }) {
  return <span className={`ui-tip ui-tip--${side}`}>{children}<span role="tooltip" className={`ui-tip-body ${wrap ? 'wrap' : ''}`}>{content}</span></span>;
}

export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { value: T; label: ReactNode; icon?: IconType; title?: string }[]; value: T; onChange: (v: T) => void; label?: string;
}) {
  return (
    <div className="ui-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} title={o.title} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon && <o.icon aria-hidden />}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange, className = '' }: {
  tabs: { id: T; label: ReactNode; icon?: IconType; count?: number | string }[]; active: T; onChange: (id: T) => void; className?: string;
}) {
  return (
    <div className={`ui-tabs ${className}`} role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === active} className={t.id === active ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.icon && <t.icon aria-hidden />}{t.label}{t.count != null && <span className="ui-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Card({ title, actions, children, pad = true, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean; className?: string }) {
  return (
    <section className={`ui-card ${className}`}>
      {(title || actions) && <div className="ui-card-h">{title && <h3 className="ui-section-title">{title}</h3>}{actions}</div>}
      <div className={pad ? 'ui-card--pad' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, unit, tone, size = 'md', title }: { label: ReactNode; value: ReactNode; unit?: ReactNode; tone?: 'sun' | 'earth' | 'ok' | 'warn'; size?: 'md' | 'lg'; title?: string }) {
  return (
    <div className={`ui-stat ${size === 'lg' ? 'ui-stat--lg' : ''} ${tone ? `ui-stat--${tone}` : ''}`} title={title}>
      <span className="ui-stat-label">{label}</span>
      <span className="ui-stat-value">{value}{unit != null && <small>{unit}</small>}</span>
    </div>
  );
}

export function Tag({ children, tone, icon: Ic, title }: { children: ReactNode; tone?: 'warn' | 'ok' | 'info' | 'sun' | 'earth'; icon?: IconType; title?: string }) {
  return <span className={`ui-tag ${tone ? `ui-tag--${tone}` : ''}`} title={title}>{Ic && <Ic aria-hidden />}{children}</span>;
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="ui-kbd">{children}</kbd>;
export const Spinner = () => <span className="ui-spinner" aria-label="Loading" />;
export const Skeleton = ({ w = '100%', h = 12 }: { w?: number | string; h?: number }) => <span className="ui-skel" style={{ display: 'block', width: w, height: h }} />;
export const Dot = ({ tone }: { tone: 'sun' | 'earth' | 'both' | 'comms' | 'marginal' | 'gap' | 'ecl' }) => <i className={`ui-dot ui-dot--${tone}`} aria-hidden />;
