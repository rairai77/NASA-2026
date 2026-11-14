import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Drawer } from './components/Drawer.tsx';
import { FirstPerson } from './components/FirstPerson.tsx';
import { LeftPanel } from './components/LeftPanel.tsx';
import { Chips, QueryBuilder, QueryInput } from './components/QueryBar.tsx';
import { Timeline } from './components/Timeline.tsx';
import { Badge, Toast } from './components/ui.tsx';
import { ValidationModal } from './components/ValidationModal.tsx';
import { buildCsv, download, type CsvRow } from './lib/csv.ts';
import { encodeState } from './lib/share.ts';
import { DAY, HOUR } from './lib/time.ts';
import { bootstrap, refreshData, setCursor, stubOf, toast, useStore, windowOf, useActiveIds } from './store.ts';

const Globe = lazy(() => import('./globe/Globe.tsx'));

function currentHash(): string {
  const s = useStore.getState();
  const sel = s.selected ? s.targets[s.selected] : null;
  const cmp = s.compare.map((id) => s.targets[id]).filter(Boolean).map(stubOf);
  return `#s=${encodeState({ q: s.query, sel: sel ? stubOf(sel) : null, cmp, t: Math.round(s.cursor), cam: camState(), ed: s.educator, tab: s.leftTab })}`;
}
let camState: () => ReturnType<typeof import('./globe/Globe.tsx').getCameraState> = () => null;
import('./globe/Globe.tsx').then((m) => { camState = m.getCameraState; });

function exportCsv() {
  const s = useStore.getState();
  const rows: CsvRow[] = [];
  const ids = [...(s.selected ? [s.selected] : []), ...s.compare.filter((c) => c !== s.selected)];
  for (const id of ids) {
    const t = s.targets[id], d = s.data[id];
    if (t && d?.vis) rows.push({ id, name: t.name, lat: t.lat, lon: t.lon, vis: d.vis, extra: { ...(t.metrics ?? {}), elev_m: d.horizon?.siteElevM } });
  }
  if (!rows.length) { toast('Select a site first, then export.'); return; }
  const [a, b] = windowOf(s.query);
  download('lunar-navigator-export.csv', buildCsv(rows, `${new Date(a * 1000).toISOString()} to ${new Date(b * 1000).toISOString()}`));
}

function TopBar() {
  const educator = useStore((s) => s.educator);
  const info = useStore((s) => s.info);
  return (
    <header className="topbar">
      <div className="brand"><span className="logo" aria-hidden /><div><b>Lunar Landing Site Navigator</b><small>Sun {'·'} Earth {'·'} horizon</small></div></div>
      <QueryInput />
      <div className="top-actions">
        {info?.mode === 'mock' && <Badge tone="demo" title={info.notes.join('\n')}>demo data</Badge>}
        <button className={`btn toggle ${educator ? 'on' : ''}`} aria-pressed={educator} onClick={() => useStore.setState({ educator: !educator })} title="Plain-language labels and short 'why?' explanations">
          Educator mode
        </button>
        <button className="btn" onClick={() => { navigator.clipboard?.writeText(location.href).then(() => toast('Link copied to clipboard'), () => toast('Copy failed: copy the address bar URL')); }}>Share</button>
        <button className="btn" onClick={exportCsv} title="Export timeline and metrics of the selected sites as CSV">CSV</button>
        <button className="btn ghost" onClick={() => useStore.setState({ validationOpen: true })}>How we know it{'’'}s right</button>
      </div>
      <div className="chiprow"><Chips /></div>
    </header>
  );
}

export default function App() {
  const selected = useStore((s) => s.selected);
  const fpOpen = useStore((s) => s.fpOpen);
  const ids = useActiveIds();
  const query = useStore((s) => s.query);
  const compareKey = useStore((s) => s.compare.join(','));
  const targetsReady = useStore((s) => Object.keys(s.targets).length > 0);

  useEffect(() => { bootstrap().catch((e) => { console.error(e); toast(`Engine failed to start: ${e.message}`); }); }, []);

  // load horizon + series for everything on the timeline
  useEffect(() => { if (targetsReady) refreshData(); }, [selected, compareKey, query.window.start, query.window.end, query.height_m, targetsReady]);
  // keep fresh when a target gets registered after selection (restored state)
  useEffect(() => useStore.subscribe((s, p) => { if (s.targets !== p.targets && (s.selected || s.compare.length)) refreshData(); }), []);
  void ids;

  // URL hash: shareable state
  useEffect(() => {
    const id = setInterval(() => { try { history.replaceState(null, '', currentHash()); } catch { /* ignore */ } }, 1500);
    return () => clearInterval(id);
  }, []);

  // playback
  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const s = useStore.getState();
      if (s.playing) {
        const dt = Math.min(0.1, (now - last) / 1000);
        const [, b] = windowOf(s.query);
        const next = s.cursor + dt * s.speed;
        if (next >= b) { useStore.setState({ playing: false, cursor: b }); } else useStore.setState({ cursor: next });
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const s = useStore.getState();
      if (e.key === ' ') { e.preventDefault(); useStore.setState({ playing: !s.playing }); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setCursor(s.cursor + (e.shiftKey ? DAY : HOUR)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setCursor(s.cursor - (e.shiftKey ? DAY : HOUR)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const gridCols = useMemo(() => (selected ? '320px minmax(0,1fr) 356px' : '320px minmax(0,1fr)'), [selected]);
  return (
    <div className="app">
      <TopBar />
      <main className="main" style={{ gridTemplateColumns: gridCols }}>
        <LeftPanel />
        <div className="center">
          <Suspense fallback={<div className="globe-loading">Loading 3D Moon{'…'}</div>}><Globe /></Suspense>
        </div>
        {selected && <Drawer />}
        {fpOpen && <div className="fp-layer"><FirstPerson /></div>}
      </main>
      <Timeline />
      <QueryBuilder />
      <ValidationModal />
      <Toast />
    </div>
  );
}
