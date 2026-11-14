import { useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown, ArrowDownNarrowWide, ArrowUp, ArrowUpWideNarrow, CalendarDays, Funnel, MapPin, Plus, RadioTower, Rocket, Search, SlidersHorizontal,
  Sparkles, Telescope, TriangleAlert, X, Zap, GripVertical,
} from 'lucide-react';
import type { Query } from '../engine/api.ts';
import { describeRegion, regionIsCoarse } from '../query/query.ts';
import { metricLabel, fmtMetric, METRIC_BY_NAME } from '../query/metrics.ts';
import { applyNasaScreening, parseText, patchQuery, setPanel, useStore } from '../store.ts';
import { FilterEditor, ObjectiveEditor, RegionEditor, WindowEditor, newFilter, newObjective } from './editors.tsx';
import { Button, IconButton, NumInput, Popover, Spinner, useEscape, type IconType } from './ui.tsx';
import { PanelFields, panelSummary } from './PowerPanel.tsx';

export interface Example { label: string; sub: string; text: string; icon: IconType }
export const EXAMPLE_LIST: Example[] = [
  { label: 'CLPS slipped to June 2028', sub: 'Best south pole sites, 6+ days of Sun and Earth', icon: Rocket,
    text: 'Our CLPS launch slipped from March to June 2028 — best south pole sites with at least 6 days of continuous sun and Earth' },
  { label: 'Flattest near Shackleton', sub: 'Shortest night in 2027', icon: Telescope, text: 'Flattest site near Shackleton with the shortest night in 2027' },
  { label: 'Apollo 11 vs Malapert', sub: 'Side by side, December 2026', icon: MapPin, text: 'Compare Apollo 11 with Malapert Massif for December 2026' },
  { label: 'Longest sunlight in 2027', sub: 'Most hours of Sun at the pole', icon: Sparkles, text: 'Sites at the south pole with the most sun hours in 2027' },
  { label: 'Sun and Earth, March 2027', sub: 'Most hours with both up', icon: CalendarDays, text: 'Best south pole sites in March 2027 with the most hours of Sun and Earth together' },
];
export const EXAMPLES = EXAMPLE_LIST.map((e) => e.text);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtWindow(a: string, b: string): string {
  const [ya, ma, da] = a.slice(0, 10).split('-').map(Number), [yb, mb, db] = b.slice(0, 10).split('-').map(Number);
  if (!ya || !yb) return `${a.slice(0, 10)} to ${b.slice(0, 10)}`;
  return ya === yb ? `${MON[ma - 1]} ${da} – ${MON[mb - 1]} ${db}, ${yb}` : `${MON[ma - 1]} ${da}, ${ya} – ${MON[mb - 1]} ${db}, ${yb}`;
}

function ChipShell({ kind, label, value, icon: Ic, children, onRemove, extra, draggable, dragProps, warn, popClass = '' }: {
  warn?: string; kind: string; label?: string; value?: ReactNode; icon?: IconType; children: ReactNode; onRemove?: () => void; extra?: ReactNode; draggable?: boolean;
  dragProps?: React.HTMLAttributes<HTMLSpanElement>; popClass?: string;
}) {
  return (
    <Popover className={`chipwrap ${popClass}`} trigger={(open, toggle) => (
      <span className={`chip k-${kind} ${open ? 'open' : ''} ${warn ? 'warn' : ''}`} title={warn} draggable={draggable} {...dragProps}>
        {extra}
        <button className="chip-main" onClick={toggle} aria-expanded={open}>
          {warn ? <TriangleAlert aria-hidden /> : Ic && <Ic aria-hidden />}
          {label && <span className="chip-l">{label}</span>}
          {value != null && <span className="chip-v">{value}</span>}
        </button>
        {onRemove && <button className="chip-x" aria-label="Remove" onClick={onRemove}><X aria-hidden /></button>}
      </span>
    )}>
      {children}
    </Popover>
  );
}

const Word = ({ children }: { children: ReactNode }) => <span className="qs-word">{children}</span>;
const opSym = (op: string) => op.replace('<=', '≤').replace('>=', '≥');

export function Chips() {
  const q = useStore((s) => s.query);
  const unparsed = useStore((s) => s.unparsed);
  const edu = useStore((s) => s.educator);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const coarse = regionIsCoarse(q.region);
  const setObj = (objectives: Query['objectives']) => patchQuery({ objectives, weights: q.mode === 'weighted' ? objectives.map((_, i) => q.weights?.[i] ?? 1) : q.weights });

  return (
    <div className="chips" aria-label="Query chips" data-tour="chips">
      <Word>Rank</Word>
      <ChipShell kind="region" icon={MapPin} value={`${describeRegion(q.region)}${coarse ? ' · coarse 10 km' : ''}`} warn={coarse ? 'Coarse 10 km screening: results are leads, not 20 m answers' : undefined}>
        <RegionEditor q={q} onChange={(region) => patchQuery({ region })} />
      </ChipShell>
      <Word>for</Word>
      <ChipShell kind="window" icon={CalendarDays} value={fmtWindow(q.window.start, q.window.end)}>
        <WindowEditor q={q} onChange={(window) => patchQuery({ window })} />
      </ChipShell>
      <Word>by</Word>
      {q.objectives.map((o, i) => (
        <ChipShell key={`o${i}`} kind="objective" value={<>{q.objectives.length > 1 && <b className="chip-n">{i + 1}</b>}{metricLabel(o.metric, edu)}</>}
          draggable dragProps={{
            onDragStart: (e) => { setDragIdx(i); e.dataTransfer.effectAllowed = 'move'; },
            onDragOver: (e) => { if (dragIdx !== null) e.preventDefault(); },
            onDrop: (e) => {
              e.preventDefault();
              if (dragIdx === null || dragIdx === i) return;
              const arr = [...q.objectives]; const [m] = arr.splice(dragIdx, 1); arr.splice(i, 0, m);
              setObj(arr); setDragIdx(null);
            },
            onDragEnd: () => setDragIdx(null),
          }}
          extra={<button className="chip-dir" title={o.dir === 'max' ? 'Maximise (click for minimise)' : 'Minimise (click for maximise)'} aria-label={`Direction ${o.dir}`}
            onClick={() => setObj(q.objectives.map((x, j) => (j === i ? { ...x, dir: x.dir === 'max' ? 'min' : 'max' } : x)))}>
            {o.dir === 'max' ? <ArrowUpWideNarrow aria-hidden /> : <ArrowDownNarrowWide aria-hidden />}</button>}
          onRemove={q.objectives.length > 1 ? () => setObj(q.objectives.filter((_, j) => j !== i)) : undefined}>
          <ObjectiveEditor o={o} onChange={(no) => setObj(q.objectives.map((x, j) => (j === i ? no : x)))} />
          <p className="hint"><GripVertical aria-hidden size={12} /> Drag chips to reorder priority.</p>
        </ChipShell>
      ))}
      <button className="chip add" onClick={() => setObj([...q.objectives, newObjective(q.objectives)])} title="Add an objective" aria-label="Add an objective"><span className="chip-main"><Plus aria-hidden />Objective</span></button>
      {q.filters.length > 0 && <Word>where</Word>}
      {q.filters.map((f, i) => (
        <ChipShell key={`f${i}`} kind="filter" icon={Funnel} label={metricLabel(f.metric, edu)}
          warn={coarse && METRIC_BY_NAME[f.metric]?.polarOnly ? `${metricLabel(f.metric)} does not exist on the 10 km global grid: this filter removes every result` : undefined}
          value={`${opSym(f.op)} ${fmtMetric(f.metric, f.value).replace(/\s*\(.*\)/, '')}`}
          onRemove={() => patchQuery({ filters: q.filters.filter((_, j) => j !== i) })}>
          <FilterEditor f={f} onChange={(nf) => patchQuery({ filters: q.filters.map((x, j) => (j === i ? nf : x)) })} />
        </ChipShell>
      ))}
      <button className="chip add" onClick={() => patchQuery({ filters: [...q.filters, newFilter()] })} title="Add a filter" aria-label="Add a filter"><span className="chip-main"><Plus aria-hidden />Filter</span></button>
      <span className="qs-spacer" aria-hidden />
      {q.power && (
        <ChipShell kind="power" icon={Zap} value={panelSummary(q.power)} popClass="pop-right"
          onRemove={() => patchQuery({ power: null, filters: q.filters.filter((f) => !METRIC_BY_NAME[f.metric]?.needsPower), objectives: q.objectives.some((o) => !METRIC_BY_NAME[o.metric]?.needsPower) ? q.objectives.filter((o) => !METRIC_BY_NAME[o.metric]?.needsPower) : [{ metric: 'sun_hours', dir: 'max' }] })}>
          <PanelFields panel={q.power} onChange={setPanel} />
          <p className="hint">Lets Energy and Battery needed be used as filters / objectives.</p>
        </ChipShell>
      )}
      <button className={`chip toggle ${q.relay ? 'on' : ''}`} aria-pressed={!!q.relay} onClick={() => patchQuery({ relay: !q.relay })}
        title="Assume a relay orbiter gives continuous Earth contact: comms hours equal the whole window">
        <span className="chip-main"><RadioTower aria-hidden /><span className="chip-v">Relay</span><i className="chip-switch" aria-hidden /></span>
      </button>
      <ChipShell kind="more" icon={SlidersHorizontal} label="More" value={`top ${q.k}`} popClass="pop-right">
        <div className="ed">
          <label>Observer height above terrain (m)<NumInput value={q.height_m} min={0} step={0.5} onChange={(height_m) => patchQuery({ height_m })} /></label>
          <div className="row">
            <label>Results (top k)<NumInput value={q.k} min={1} max={50} onChange={(k) => patchQuery({ k: Math.round(Math.max(1, Math.min(50, k))) })} /></label>
            <label>Min separation (km)<NumInput value={q.min_separation_km} min={0} step={0.5} onChange={(min_separation_km) => patchQuery({ min_separation_km })} /></label>
          </div>
          <label>Ordering
            <select value={q.mode} onChange={(e) => patchQuery({ mode: e.target.value as Query['mode'], weights: e.target.value === 'weighted' ? q.objectives.map(() => 1) : null })}>
              <option value="lexicographic">Lexicographic (objectives in order)</option><option value="weighted">Weighted</option>
            </select>
          </label>
          {q.mode === 'weighted' && q.objectives.map((o, i) => (
            <label key={i}>{metricLabel(o.metric, edu)} weight<NumInput value={q.weights?.[i] ?? 1} step={0.1} min={0} onChange={(w) => patchQuery({ weights: q.objectives.map((_, j) => (j === i ? w : q.weights?.[j] ?? 1)) })} /></label>
          ))}
        </div>
      </ChipShell>
      <Popover className="chipwrap pop-right" trigger={(open, toggle) => (
        <span className={`chip k-preset ${open ? 'open' : ''}`}>
          <button className="chip-main" onClick={toggle} aria-expanded={open}><Sparkles aria-hidden /><span className="chip-v">Presets</span></button>
        </span>
      )}>
        <div className="ed presets">
          <div className="ui-section-title">Presets</div>
          <button className="preset-item" onClick={() => { applyNasaScreening(); document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }}>
            <Sparkles aria-hidden /><span><b>NASA Artemis screening (approx.)</b>
              <small>Slope ≤ 10°, Earth visible ≥ 25% and Sun ≥ 5% of the window, within 6° of the pole. Approximates public Artemis criteria.</small></span>
          </button>
        </div>
      </Popover>
      {unparsed.map((u, i) => (
        <span key={i} className="chip unparsed" title="Not understood by the parser; ignored">
          <span className="chip-main">{u}</span>
          <button className="chip-x" aria-label="Dismiss" onClick={() => useStore.setState({ unparsed: unparsed.filter((_, j) => j !== i) })}><X aria-hidden /></button>
        </span>
      ))}
    </div>
  );
}

export function QueryStrip() {
  return <div className="qstrip"><Chips /></div>;
}

/** The hero control: natural-language question with examples on focus. */
export function QueryInput({ onDone }: { onDone?: () => void }) {
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  const parsing = useStore((s) => s.parsing);
  const ref = useRef<HTMLInputElement>(null);
  const submit = (t: string) => { if (t.trim()) { parseText(t.trim()); ref.current?.blur(); setFocus(false); onDone?.(); } };
  return (
    <div className={`ask ${focus ? 'focus' : ''}`} data-tour="ask">
      <Search className="ask-ico" aria-hidden />
      <input
        ref={ref} className="qtext" value={text} maxLength={500} aria-label="Describe your mission request" autoComplete="off"
        placeholder="Ask: best south pole sites in June 2028 with 6 days of Sun and Earth"
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(text); else if (e.key === 'Escape') { ref.current?.blur(); } }}
      />
      <Button variant="primary" size="sm" className="ask-go" disabled={parsing} onMouseDown={(e) => e.preventDefault()} onClick={() => submit(text)}>{parsing ? <><Spinner />Parsing</> : 'Ask'}</Button>
      {focus && (
        <div className="ask-pop" role="listbox" aria-label="Example questions" onMouseDown={(e) => e.preventDefault()}>
          <div className="ui-section-title">Try asking</div>
          {EXAMPLE_LIST.map((e) => (
            <button key={e.label} role="option" aria-selected={false} className="ask-ex" onClick={() => { setText(e.text); submit(e.text); }}>
              <e.icon aria-hidden /><span><b>{e.label}</b><small>{e.sub}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function QueryBuilder() {
  const open = useStore((s) => s.builderOpen);
  const q = useStore((s) => s.query);
  const close = () => useStore.setState({ builderOpen: false });
  useEscape(open, close);
  if (!open) return null;
  const move = (i: number, d: number) => { const a = [...q.objectives]; [a[i + d], a[i]] = [a[i], a[i + d]]; patchQuery({ objectives: a }); };
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal" role="dialog" aria-label="Query builder">
        <header><div><h2>Build query</h2><p className="modal-sub">Every change re-ranks immediately; the chips under the top bar always show the current query.</p></div>
          <IconButton icon={X} label="Close" tip="none" onClick={close} /></header>
        <div className="modal-body builder">
          <section><h3><CalendarDays aria-hidden />Window</h3><WindowEditor q={q} onChange={(window) => patchQuery({ window })} /></section>
          <section><h3><MapPin aria-hidden />Region</h3><RegionEditor q={q} onChange={(region) => patchQuery({ region })} /></section>
          <section>
            <h3><Funnel aria-hidden />Filters<small>keep only sites that pass</small></h3>
            {q.filters.length === 0 && <p className="hint">No filters yet.</p>}
            {q.filters.map((f, i) => <FilterEditor key={i} f={f} onChange={(nf) => patchQuery({ filters: q.filters.map((x, j) => (j === i ? nf : x)) })} onRemove={() => patchQuery({ filters: q.filters.filter((_, j) => j !== i) })} />)}
            <div><Button size="sm" icon={Plus} onClick={() => patchQuery({ filters: [...q.filters, newFilter()] })}>Add filter</Button></div>
          </section>
          <section>
            <h3><ArrowUpWideNarrow aria-hidden />Objectives<small>in priority order</small></h3>
            {q.objectives.map((o, i) => (
              <div className="row ed-row" key={i}>
                <b className="chip-n">{i + 1}</b>
                <ObjectiveEditor o={o} onChange={(no) => patchQuery({ objectives: q.objectives.map((x, j) => (j === i ? no : x)) })}
                  onRemove={q.objectives.length > 1 ? () => patchQuery({ objectives: q.objectives.filter((_, j) => j !== i) }) : undefined} />
                <IconButton icon={ArrowUp} label="Move up" size="sm" tip="none" disabled={i === 0} onClick={() => move(i, -1)} />
                <IconButton icon={ArrowDown} label="Move down" size="sm" tip="none" disabled={i === q.objectives.length - 1} onClick={() => move(i, 1)} />
              </div>
            ))}
            <div><Button size="sm" icon={Plus} onClick={() => patchQuery({ objectives: [...q.objectives, newObjective(q.objectives)] })}>Add objective</Button></div>
          </section>
          <section className="wide">
            <h3><SlidersHorizontal aria-hidden />Other</h3>
            <div className="row">
              <label>Observer height (m)<NumInput value={q.height_m} min={0} step={0.5} onChange={(height_m) => patchQuery({ height_m })} /></label>
              <label>Results (k)<NumInput value={q.k} min={1} max={50} onChange={(k) => patchQuery({ k: Math.round(Math.max(1, Math.min(50, k))) })} /></label>
              <label>Min separation (km)<NumInput value={q.min_separation_km} min={0} step={0.5} onChange={(min_separation_km) => patchQuery({ min_separation_km })} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={!!q.relay} onChange={(e) => patchQuery({ relay: e.target.checked })} />Assume relay orbiter (continuous comms)</label>
            <div><Button size="sm" icon={Sparkles} onClick={applyNasaScreening} title="Adds slope, Earth and Sun filters from public Artemis screening criteria (approximation)">NASA Artemis screening (approx.)</Button></div>
          </section>
        </div>
        <footer><Button variant="primary" size="lg" onClick={close}>Show results</Button></footer>
      </div>
    </div>
  );
}
