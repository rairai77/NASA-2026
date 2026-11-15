import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, Info, Moon, Sun, X } from 'lucide-react';
import { toggleTheme, useTheme } from '../lib/theme.ts';
import { useStore } from '../store.ts';
import { ALIASES, TIPS } from '../lib/educatorText.ts';

export const WHY = TIPS;

/** Small (i) that explains a term: hover or keyboard focus shows the tooltip, a tap pins the text at the bottom of the screen. */
/** A small ⓘ with the plain-language note for one glossary id, or several joined into one note. */
export function Why({ id }: { id: string | string[] }) {
  const [pinned, setPinned] = useState(false);
  const text = (Array.isArray(id) ? id : [id]).map((i) => WHY[ALIASES[i] ?? i]).filter(Boolean).join(' ');
  if (!text) return null;
  return (
    <>
      <Tooltip content={text} side="bottom" wrap>
        <button type="button" className="why" aria-label={`What does this mean? ${text}`} aria-expanded={pinned}
          onClick={(e) => { e.stopPropagation(); setPinned((p) => !p); }} onBlur={() => setPinned(false)}>
          <Info aria-hidden />
        </button>
      </Tooltip>
      {pinned && createPortal(<div className="why-note" role="note">{text}</div>, document.body)}
    </>
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
      {open && (
        <div className="pop" role="dialog" onClick={(e) => { if ((e.target as HTMLElement).closest('[data-close-popover]')) { setOpen(false); onToggle?.(false); } }}>
          {children}
        </div>
      )}
    </span>
  );
}

export function Badge({ children, tone = '', title }: { children: ReactNode; tone?: string; title?: string }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}

export function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  const bad = /fail|unavailable|error|not available|select a site/i.test(t.msg);
  const Ic = bad ? CircleAlert : Info;
  return <div className={`toast ${bad ? 'bad' : ''}`} role="status" key={t.id}><Ic aria-hidden className="toast-ico" /><span>{t.msg}</span><button className="toast-x" aria-label="Dismiss" onClick={() => useStore.setState({ toast: null })}><X aria-hidden /></button></div>;
}

/** Mouse wheel scrolls a horizontal scroller sideways (vertical gestures only, and only while there is room in that direction). Trackpad swipes are left alone. */
export function useWheelHScroll(ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (dy > 0 ? el.scrollLeft >= max - 1 : el.scrollLeft <= 1) return;
      e.preventDefault();
      el.scrollLeft += dy;
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [ref]);
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

type Side = 'top' | 'bottom' | 'left' | 'right';
const TIP_GAP = 8, TIP_MARGIN = 8;

/** Place a bubble of size w x h next to the trigger rect r: preferred side, else the opposite, else a perpendicular one; always clamped to the viewport. */
export function placeTip(r: DOMRect, w: number, h: number, side: Side, vw: number, vh: number): { x: number; y: number } {
  const fits: Record<Side, boolean> = {
    top: r.top - TIP_GAP - h >= TIP_MARGIN, bottom: r.bottom + TIP_GAP + h <= vh - TIP_MARGIN,
    left: r.left - TIP_GAP - w >= TIP_MARGIN, right: r.right + TIP_GAP + w <= vw - TIP_MARGIN,
  };
  const opp: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const order: Side[] = [side, opp[side], ...(side === 'top' || side === 'bottom' ? ['right', 'left'] as Side[] : ['bottom', 'top'] as Side[])];
  const use = order.find((s) => fits[s]) ?? side;
  let x: number, y: number;
  if (use === 'top') { x = r.left + r.width / 2 - w / 2; y = r.top - TIP_GAP - h; }
  else if (use === 'bottom') { x = r.left + r.width / 2 - w / 2; y = r.bottom + TIP_GAP; }
  else if (use === 'left') { x = r.left - TIP_GAP - w; y = r.top + r.height / 2 - h / 2; }
  else { x = r.right + TIP_GAP; y = r.top + r.height / 2 - h / 2; }
  x = Math.max(TIP_MARGIN, Math.min(x, vw - TIP_MARGIN - w));
  y = Math.max(TIP_MARGIN, Math.min(y, vh - TIP_MARGIN - h));
  return { x, y };
}

/** Wrap any element. The bubble is rendered in a portal on <body>, positioned from the trigger rect (flips and clamps to the viewport),
 *  shown after a short hover delay, immediately on keyboard focus, hidden on scroll, resize, Escape and click. */
export function Tooltip({ content, side = 'top', wrap, children }: { content: ReactNode; side?: Side; wrap?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trig = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const hide = () => { clearTimeout(timer.current); setOpen(false); };
  const showSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 350); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const off = () => setOpen(false);
    window.addEventListener('keydown', k); window.addEventListener('scroll', off, true); window.addEventListener('resize', off);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('scroll', off, true); window.removeEventListener('resize', off); };
  }, [open]);
  useLayoutEffect(() => {
    const t = trig.current, b = tip.current;
    if (!open || !t || !b) return;
    const { x, y } = placeTip(t.getBoundingClientRect(), b.offsetWidth, b.offsetHeight, side, window.innerWidth, window.innerHeight);
    b.style.left = `${x}px`; b.style.top = `${y}px`;
  }, [open, side, content]);
  return (
    <span ref={trig} className="ui-tip" aria-describedby={open ? id : undefined}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') showSoon(); }} onPointerLeave={hide} onPointerDown={hide}
      onFocus={(e) => { if ((e.target as HTMLElement).matches?.(':focus-visible')) { clearTimeout(timer.current); setOpen(true); } }} onBlur={hide}>
      {children}
      {open && createPortal(<span ref={tip} id={id} role="tooltip" className={`ui-tip-body ${wrap ? 'wrap' : ''}`}>{content}</span>, document.body)}
    </span>
  );
}

/** Sun / Moon button for the top bar. */
export function ThemeToggle() {
  const theme = useTheme();
  return <IconButton icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme} />;
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
  tabs: { id: T; label: ReactNode; icon?: IconType; count?: number | string; title?: string }[]; active: T; onChange: (id: T) => void; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useWheelHScroll(ref);
  // keep the active tab visible when the bar scrolls horizontally (never touches vertical scroll)
  useEffect(() => {
    const bar = ref.current, on = bar?.querySelector<HTMLElement>('button.on');
    if (!bar || !on) return;
    const l = on.offsetLeft - 8, r = on.offsetLeft + on.offsetWidth + 8;
    if (l < bar.scrollLeft) bar.scrollLeft = l; else if (r > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = r - bar.clientWidth;
  }, [active]);
  return (
    <div ref={ref} className={`ui-tabs ${className}`} role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" title={t.title} aria-label={t.title} aria-selected={t.id === active} className={t.id === active ? 'on' : ''} onClick={() => onChange(t.id)}>
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
