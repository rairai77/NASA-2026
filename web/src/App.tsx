import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowLeft, Compass, Download, Ellipsis, Link2, ListOrdered, MapPin, Moon, Search, Sun, ShieldCheck, SlidersHorizontal, Clock } from 'lucide-react';
import { Drawer } from './components/Drawer.tsx';
import { FirstPerson } from './components/FirstPerson.tsx';
import { LeftPanel } from './components/LeftPanel.tsx';
import { QueryBuilder, QueryInput, QueryStrip } from './components/QueryBar.tsx';
import { Timeline } from './components/Timeline.tsx';
import { Badge, Button, IconButton, Popover, Tabs, ThemeToggle, Toast } from './components/ui.tsx';
import { toggleTheme, useTheme, writePref } from './lib/theme.ts';
import { Splash } from './components/Splash.tsx';
import { Welcome } from './components/Welcome.tsx';
import { ValidationModal } from './components/ValidationModal.tsx';
import { buildCsv, download, type CsvRow } from './lib/csv.ts';
import { encodeState } from './lib/share.ts';
import { DAY, HOUR } from './lib/time.ts';
import { bootstrap, dataKey, refreshData, saveScenario, setCursor, stubOf, toast, useStore, windowOf, useActiveIds } from './store.ts';
import { Tour } from './components/Tour.tsx';

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

function useMedia(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    h(); mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}

const closePops = () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

function shareLink() {
  try { history.replaceState(null, '', currentHash()); } catch { /* ignore */ }
  navigator.clipboard?.writeText(location.href).then(() => toast('Link copied to clipboard'), () => toast('Copy failed: copy the address bar URL'));
}

function TopBar() {
  const info = useStore((s) => s.info);
  const theme = useTheme();
  const [askOpen, setAskOpen] = useState(false);
  const build = () => useStore.setState({ builderOpen: true });
  const how = () => useStore.setState({ validationOpen: true });
  const tour = () => useStore.setState({ tourStep: 0 });
  return (
    <header className={`topbar ${askOpen ? 'ask-open' : ''}`}>
      <div className="brand"><span className="logo" aria-hidden /><b>Lunar Landing Site Navigator</b></div>
      <div className="tb-mid">
        <button className="tb-back phone-only" aria-label="Close search" onClick={() => setAskOpen(false)}><ArrowLeft aria-hidden /></button>
        <QueryInput onDone={() => setAskOpen(false)} />
        <Button variant="ghost" icon={SlidersHorizontal} className="tb-build desk-only" onClick={build}><span className="lbl">Build query</span></Button>
      </div>
      <div className="tb-right">
        {info?.mode === 'mock' && <Badge tone="demo" title={info.notes.join('\n')}>demo data</Badge>}
        <span className="desk-only tb-icons">
          <IconButton icon={Link2} label="Share link" onClick={shareLink} />
          <IconButton icon={Download} label="Export CSV of the selected sites" onClick={exportCsv} />
          <ThemeToggle />
        </span>
        <Button variant="ghost" icon={Compass} className="tb-tour desk-only" onClick={tour} title="Start the 60-second guided tour"><span className="lbl">Tour</span></Button>
        <Button icon={ShieldCheck} className="tb-how desk-only" data-tour="how" onClick={how}><span className="lbl">How we know</span></Button>
        <IconButton icon={Search} label="Ask a question" className="phone-only" onClick={() => { setAskOpen(true); setTimeout(() => (document.querySelector('.qtext') as HTMLInputElement | null)?.focus(), 30); }} />
        <Popover className="phone-only pop-right" trigger={(open, toggle) => <IconButton icon={Ellipsis} label="More actions" active={open} tip="none" onClick={toggle} />}>
          <div className="menu" onClick={closePops}>
            <button onClick={build}><SlidersHorizontal aria-hidden />Build query</button>
            <button onClick={shareLink}><Link2 aria-hidden />Share link</button>
            <button onClick={exportCsv}><Download aria-hidden />Export CSV</button>
            <button onClick={toggleTheme}>{theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
            <button onClick={tour}><Compass aria-hidden />Take the tour</button>
            <button onClick={how}><ShieldCheck aria-hidden />How we know it{'’'}s right</button>
          </div>
        </Popover>
      </div>
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

  // launch-slip preset: once the shifted window has been computed for the selected site, save it as B
  useEffect(() => useStore.subscribe((s) => {
    if (!s.pendingSlip || !s.selected) return;
    const d = s.data[s.selected];
    if (d?.vis && d.key === dataKey(s.query) && !d.loading) { useStore.setState({ pendingSlip: false }); saveScenario('B'); }
  }), []);

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
        const stop = s.playUntil !== null ? Math.min(b, s.playUntil) : b;
        if (next >= stop) useStore.setState({ playing: false, cursor: stop, playUntil: null });
        else useStore.setState({ cursor: next });
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
      else if ((e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (window.matchMedia('(max-width: 899px)').matches) return;
        useStore.setState(e.key === '[' ? { leftCollapsed: !s.leftCollapsed } : { rightCollapsed: !s.rightCollapsed });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const phone = useMedia('(max-width: 899px)');
  const leftC = useStore((s) => s.leftCollapsed);
  const rightC = useStore((s) => s.rightCollapsed);
  const tlC = useStore((s) => s.timelineCollapsed);
  // persist collapse state; the globe resizes with its container (Cesium watches its canvas size), a resize event nudges it after the grid transition
  useEffect(() => {
    writePref('llsn.ui.left', leftC ? '1' : '0'); writePref('llsn.ui.right', rightC ? '1' : '0'); writePref('llsn.ui.timeline', tlC ? '1' : '0');
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 260);
    return () => clearTimeout(t);
  }, [leftC, rightC, tlC]);
  const phoneTab = useStore((s) => s.phoneTab);
  const resultsN = useStore((s) => s.results?.results.length ?? 0);
  const tab = phoneTab === 'site' && !selected ? 'results' : phoneTab;

  // phone: picking something on the globe or in the list opens the Site sheet (only for user-initiated changes)
  useEffect(() => {
    let last = 0;
    const down = () => { last = performance.now(); };
    window.addEventListener('pointerdown', down, true);
    const un = useStore.subscribe((st, p) => {
      if (st.selected && st.selected !== p.selected && window.matchMedia('(max-width: 899px)').matches && performance.now() - last < 700 && st.tourStep === null) useStore.setState({ phoneTab: 'site' });
    });
    return () => { window.removeEventListener('pointerdown', down, true); un(); };
  }, []);

  const globe = (
    <div className="center" data-tour="globe">
      <Suspense fallback={<div className="globe-loading">Loading 3D Moon{'…'}</div>}><Globe /></Suspense>
      <Splash />
      <Welcome />
    </div>
  );
  return (
    <div className={`app ${phone ? 'is-phone' : ''}`}>
      <TopBar />
      <QueryStrip />
      {phone ? (
        <main className="main phone">
          {globe}
          <div className="sheet" data-tab={tab}>
            {tab === 'results' && <LeftPanel allowCollapse={false} />}
            {tab === 'timeline' && <Timeline allowCollapse={false} />}
          </div>
          {selected && tab === 'site' && !fpOpen && <div className="site-sheet"><Drawer allowCollapse={false} /></div>}
          <div className="sheet-tabs">
            <Tabs active={tab} onChange={(t) => useStore.setState({ phoneTab: t })}
              tabs={[{ id: 'results', label: 'Results', icon: ListOrdered, count: resultsN || undefined }, { id: 'site', label: 'Site', icon: MapPin }, { id: 'timeline', label: 'Timeline', icon: Clock }]} />
          </div>
          {fpOpen && <div className="fp-layer force-dark"><FirstPerson /></div>}
        </main>
      ) : (
        <>
          <main className={`main ${selected ? 'has-sel' : ''} ${leftC ? 'l-collapsed' : ''} ${rightC ? 'r-collapsed' : ''}`}>
            <LeftPanel />
            {globe}
            {selected && <Drawer />}
            {fpOpen && <div className="fp-layer force-dark"><FirstPerson /></div>}
          </main>
          <Timeline />
        </>
      )}
      <QueryBuilder />
      <ValidationModal />
      <Tour />
      <Toast />
    </div>
  );
}
