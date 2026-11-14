import { useState } from 'react';
import type { Query } from '../engine/api.ts';
import { describeQuery, describeRegion } from '../query/query.ts';
import { metricLabel, fmtMetric } from '../query/metrics.ts';
import { parseText, patchQuery, useStore } from '../store.ts';
import { FilterEditor, ObjectiveEditor, RegionEditor, WindowEditor, newFilter, newObjective } from './editors.tsx';
import { NumInput, Popover, useEscape } from './ui.tsx';

export const EXAMPLES = [
  'Our CLPS launch slipped from March to June 2028 — best south pole sites with at least 6 days of continuous sun and Earth',
  'Flattest site near Shackleton with the shortest night in 2027',
  'Compare Apollo 11 with Malapert Massif for December 2026',
];
const EXAMPLE_LABELS = ['CLPS slipped to June 2028', 'Flattest near Shackleton, short night', 'Apollo 11 vs Malapert, Dec 2026'];

function ChipShell({ kind, text, children, onRemove, extra, draggable, dragProps }: {
  kind: string; text: string; children: React.ReactNode; onRemove?: () => void; extra?: React.ReactNode; draggable?: boolean; dragProps?: React.HTMLAttributes<HTMLSpanElement>;
}) {
  return (
    <Popover className="chipwrap" trigger={(open, toggle) => (
      <span className={`chip k-${kind} ${open ? 'open' : ''}`} draggable={draggable} {...dragProps}>
        {extra}
        <button className="chip-main" onClick={toggle} aria-expanded={open}>{text}</button>
        {onRemove && <button className="chip-x" aria-label="Remove" onClick={onRemove}>{'×'}</button>}
      </span>
    )}>
      {children}
    </Popover>
  );
}

export function Chips() {
  const q = useStore((s) => s.query);
  const unparsed = useStore((s) => s.unparsed);
  const edu = useStore((s) => s.educator);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const chips = describeQuery(q, edu);
  const txt = (key: string) => chips.find((c) => c.key === key)!.text;
  const setObj = (objectives: Query['objectives']) => patchQuery({ objectives, weights: q.mode === 'weighted' ? objectives.map((_, i) => q.weights?.[i] ?? 1) : q.weights });

  return (
    <div className="chips" aria-label="Query chips">
      <ChipShell kind="window" text={`\u{1F4C5} ${txt('window')}`}><WindowEditor q={q} onChange={(window) => patchQuery({ window })} /></ChipShell>
      <ChipShell kind="region" text={`◎ ${describeRegion(q.region)}`}><RegionEditor q={q} onChange={(region) => patchQuery({ region })} /></ChipShell>
      <ChipShell kind="height" text={txt('height')}>
        <div className="ed"><label>Observer height above terrain (m)<NumInput value={q.height_m} min={0} step={0.5} onChange={(height_m) => patchQuery({ height_m })} /></label></div>
      </ChipShell>
      {q.filters.map((f, i) => (
        <ChipShell key={`f${i}`} kind="filter" text={`${metricLabel(f.metric, edu)} ${f.op.replace('<=', '≤').replace('>=', '≥')} ${fmtMetric(f.metric, f.value).replace(/\s*\(.*\)/, '')}`}
          onRemove={() => patchQuery({ filters: q.filters.filter((_, j) => j !== i) })}>
          <FilterEditor f={f} onChange={(nf) => patchQuery({ filters: q.filters.map((x, j) => (j === i ? nf : x)) })} />
        </ChipShell>
      ))}
      <button className="chip add" onClick={() => patchQuery({ filters: [...q.filters, newFilter()] })} title="Add a filter">+ filter</button>
      <span className="chip-sep" aria-hidden>{'→'}</span>
      {q.objectives.map((o, i) => (
        <ChipShell key={`o${i}`} kind="objective" text={`${i + 1}. ${metricLabel(o.metric, edu)}`}
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
          extra={<button className="chip-dir" title="Toggle max / min" aria-label={`Direction ${o.dir}`} onClick={() => setObj(q.objectives.map((x, j) => (j === i ? { ...x, dir: x.dir === 'max' ? 'min' : 'max' } : x)))}>{o.dir === 'max' ? '▲' : '▼'}</button>}
          onRemove={q.objectives.length > 1 ? () => setObj(q.objectives.filter((_, j) => j !== i)) : undefined}>
          <ObjectiveEditor o={o} onChange={(no) => setObj(q.objectives.map((x, j) => (j === i ? no : x)))} />
          <p className="hint">Drag chips to reorder priority.</p>
        </ChipShell>
      ))}
      <button className="chip add" onClick={() => setObj([...q.objectives, newObjective(q.objectives)])} title="Add an objective">+ objective</button>
      <ChipShell kind="k" text={`top ${q.k}`}>
        <div className="ed">
          <label>Results (k)<NumInput value={q.k} min={1} max={50} onChange={(k) => patchQuery({ k: Math.round(Math.max(1, Math.min(50, k))) })} /></label>
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
      <ChipShell kind="sep" text={`≥ ${q.min_separation_km} km apart`}>
        <div className="ed"><label>Min separation between results (km)<NumInput value={q.min_separation_km} min={0} step={0.5} onChange={(min_separation_km) => patchQuery({ min_separation_km })} /></label></div>
      </ChipShell>
      {unparsed.map((u, i) => (
        <span key={i} className="chip unparsed" title="Not understood by the parser; ignored">
          <span className="chip-main">{u}</span>
          <button className="chip-x" aria-label="Dismiss" onClick={() => useStore.setState({ unparsed: unparsed.filter((_, j) => j !== i) })}>{'×'}</button>
        </span>
      ))}
    </div>
  );
}

export function QueryInput() {
  const [text, setText] = useState('');
  const parsing = useStore((s) => s.parsing);
  const submit = (t: string) => { if (t.trim()) parseText(t.trim()); };
  return (
    <div className="qinput">
      <input
        className="qtext" value={text} maxLength={500} aria-label="Describe your mission request"
        placeholder={'Describe your mission, e.g. "best south pole sites in June 2028 with 6 days of sun and Earth"'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(text); }}
      />
      <button className="btn primary" disabled={parsing} onClick={() => submit(text)}>{parsing ? 'Parsing…' : 'Ask'}</button>
      <button className="btn" onClick={() => useStore.setState({ builderOpen: true })}>Build query</button>
      <div className="examples" aria-label="Example prompts">
        {EXAMPLES.map((e, i) => <button key={i} className="example" onClick={() => { setText(e); submit(e); }} title={e}>{EXAMPLE_LABELS[i]}</button>)}
      </div>
    </div>
  );
}

export function QueryBuilder() {
  const open = useStore((s) => s.builderOpen);
  const q = useStore((s) => s.query);
  const close = () => useStore.setState({ builderOpen: false });
  useEscape(open, close);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal" role="dialog" aria-label="Query builder">
        <header><h2>Build query</h2><button className="icon-btn" onClick={close} aria-label="Close">{'×'}</button></header>
        <div className="modal-body builder">
          <section><h3>Window</h3><WindowEditor q={q} onChange={(window) => patchQuery({ window })} /></section>
          <section><h3>Region</h3><RegionEditor q={q} onChange={(region) => patchQuery({ region })} /></section>
          <section>
            <h3>Filters</h3>
            {q.filters.map((f, i) => <FilterEditor key={i} f={f} onChange={(nf) => patchQuery({ filters: q.filters.map((x, j) => (j === i ? nf : x)) })} onRemove={() => patchQuery({ filters: q.filters.filter((_, j) => j !== i) })} />)}
            <button className="btn sm" onClick={() => patchQuery({ filters: [...q.filters, newFilter()] })}>+ Add filter</button>
          </section>
          <section>
            <h3>Objectives (in priority order)</h3>
            {q.objectives.map((o, i) => (
              <div className="row" key={i}>
                <ObjectiveEditor o={o} onChange={(no) => patchQuery({ objectives: q.objectives.map((x, j) => (j === i ? no : x)) })}
                  onRemove={q.objectives.length > 1 ? () => patchQuery({ objectives: q.objectives.filter((_, j) => j !== i) }) : undefined} />
                <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => { const a = [...q.objectives]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; patchQuery({ objectives: a }); }}>{'↑'}</button>
                <button className="icon-btn" aria-label="Move down" disabled={i === q.objectives.length - 1} onClick={() => { const a = [...q.objectives]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; patchQuery({ objectives: a }); }}>{'↓'}</button>
              </div>
            ))}
            <button className="btn sm" onClick={() => patchQuery({ objectives: [...q.objectives, newObjective(q.objectives)] })}>+ Add objective</button>
          </section>
          <section>
            <h3>Other</h3>
            <div className="row">
              <label>Observer height (m)<NumInput value={q.height_m} min={0} step={0.5} onChange={(height_m) => patchQuery({ height_m })} /></label>
              <label>Results (k)<NumInput value={q.k} min={1} max={50} onChange={(k) => patchQuery({ k: Math.round(Math.max(1, Math.min(50, k))) })} /></label>
              <label>Min separation (km)<NumInput value={q.min_separation_km} min={0} step={0.5} onChange={(min_separation_km) => patchQuery({ min_separation_km })} /></label>
            </div>
          </section>
        </div>
        <footer><button className="btn primary" onClick={close}>Show results</button></footer>
      </div>
    </div>
  );
}
