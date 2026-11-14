# UI redesign spec

Goal: a judge understands the app in 10 seconds and can get a convincing answer in 30. The current UI works but every control has the same visual weight, the header holds two rows of pills, results are titled by raw coordinates, the inspector is one long scroll, and the phone layout is broken.

## Principles

1. **Four places, four questions.** Left = *Where?* (ranked answers). Centre = *Show me* (3D Moon). Right = *Why?* (site inspector). Bottom = *When?* (timeline).
2. **Calm chrome, loud data.** Neutral dark surfaces. Colour is reserved for data semantics (Sun gold, Earth blue, both white, comms green, marginal amber, DSN gap red, eclipse magenta) and one primary action per area (sunlight gold `--primary`).
3. **Progressive disclosure.** Defaults visible, details one click away (popovers, tabs, "More").
4. **Every number has a unit and a label; every colour has a legend.**
5. **Explain once, then get out of the way** (welcome card on first visit, educator mode for more).
6. **Never lie about precision.** Coarse/representative/demo states stay visible as tags.

## Design system (already in the repo)

- Tokens and primitive styles: `web/src/design.css`. Use the CSS variables (`--surface-0..3`, `--border`, `--border-strong`, `--text`, `--text-2`, `--text-3`, `--primary`, semantic colours, `--fs-*`, `--r-*`, `--shadow-*`). Don't hard-code new hex colours except inside canvas/Cesium drawing code (mirror the tokens there).
- React primitives in `web/src/components/ui.tsx`: `Button` (variant primary/secondary/ghost/danger, size sm/md/lg, `icon`, `iconRight`, `active`), `IconButton` (icon-only, `label` = aria-label + tooltip, `solid` for floating over the globe, `tip` side), `Tooltip`, `Segmented`, `Tabs` (underline, icons, counts), `Card`, `Stat` (label + mono value + unit, tones), `Tag` (tones warn/ok/info/sun/earth), `Kbd`, `Spinner`, `Skeleton`, `Dot`. Existing `Popover`, `NumInput`, `Badge`, `Why`, `Toast` stay.
- Icons: `lucide-react` (installed). Use 15-17 px icons, stroke 2, `aria-hidden` (the primitives do this).
- Fonts: Inter Variable for UI, JetBrains Mono for numbers/coordinates/times (`.mono` or `var(--mono)`, tabular numbers).
- Type scale: 11 / 12 / 13 (base) / 15 / 18 / 24 / 32. Section titles: 11 px uppercase, tracking .08em, `--text-3`.
- Spacing: 4 px grid; panels pad 12-14 px; card gap 8-10 px.

## Layout (desktop, >= 1100 px)

**Top bar (52 px, `--surface-0`).** Left: logo + "Lunar Landing Site Navigator" (one line, 14 px semibold). Centre: the Ask field (max ~640 px) with a sparkle/search icon, placeholder "Ask: best south pole sites in June 2028 with 6 days of Sun and Earth", Enter submits, an "Ask" primary button inside the right end; focusing it opens a dropdown of the example questions (the three current examples plus 2-3 more) instead of showing them as a second row. Next to it a ghost "Build query" button (SlidersHorizontal icon). Right: icon buttons with tooltips: Share link (Link2), Export CSV (Download), Educator mode toggle (GraduationCap, active state), Tour (Compass, only in educator mode); then a secondary button "How we know" (ShieldCheck).

**Query strip (44 px, `--surface-0`, border-bottom).** Reads like a sentence: `Rank [MapPin South polar cap 85-90 S] for [Calendar Nov 14 - Dec 14, 2026] by [ArrowUpWideNarrow Sun hours] [+ Filter] ...` with the less used settings (observer height, top k, min separation) behind a "More" chip (popover), relay as a toggle chip (RadioTower icon), and presets ("NASA Artemis screening (approx.)") behind a "Presets" chip (Sparkles). Chips: 28 px, pill, `--surface-2`, icon + label in `--text-3` + value in `--text`; open state gets `--primary` border; warning variant (amber) for coarse regions or polar-only filters.

**Left panel (340 px).** `Tabs` with icons: Results (ListOrdered, count) | Sites (MapPin) | Layers (Layers) | Replay (History) | Scenarios (GitCompare, formerly "Diff").
- Results header: "Best 5 of 72,324 cells" (15 px) + sub-line "South polar cap · 1 km grid · refined at 15 min" (`--text-3`). While ranking: stage label + slim progress bar + skeleton cards.
- Result card: rank badge (gold for #1, outlined for others), **title = nearest named place** ("Near de Gerlache ridge", "Near Malapert Massif") with distance, coordinates as a mono sub-line; three `Stat`s in a row (the first objective highlighted); a labelled mini strip of the window (Sun lane, Earth lane, both) with the timeline cursor tick; "add to timeline" icon toggle (Plus/Check) top-right with tooltip. Hovering a card highlights its pin on the globe (`store.hoveredId`). Selected card: gold border + subtle glow.

**Right inspector (380 px).** Header: place name (18 px), coords mono, close button, tags (representative point, resolution, coarse, demo). "Now" hero card: two big countdown lines with Sun / Earth icons ("Sunset in 4 d 6 h", "Earth up for >= 14 d"), a small row with Sun el/az and Earth el, the charging warning as a warn `Tag`. Action row: **Stand here** (primary, Eye icon), Fly to (Crosshair), Add to timeline (Plus), More (MoreHorizontal: Landing ellipse, Export CSV). Then `Tabs`: **Sky** (horizon plot with Polar/Panorama `Segmented`, legend) | **Power** | **Traverse** | **Data** (metrics table). Persist the chosen tab (`store.inspectorTab`). Power inputs collapsed by default behind "Panel settings".

**Globe.** Default camera: an oblique view over the south pole (not the full disc) so terrain and shadows read immediately; shadows ON by default. Floating vertical toolbar at the top-right of the globe (solid `IconButton`s, tooltips on the left): Pole view (House), Fly to selection (Crosshair), Shadows (Sun, toggle), Relief (Mountain, cycles 1x/2x/4x with a tiny badge), Layers (Layers, opens the Layers tab). Bottom-left status pill: "Terrain-true shadows · 60 km · LOLA" with a spinner while a patch computes. Pins: ranked results as numbered discs (#1 gold), catalog sites as small dots; names appear on hover (and for the selected site) instead of permanent long labels. Credits small, bottom-right.

**Timeline (~150 px).** Header: round primary play/pause, speed `Segmented` (1 h/s, 6 h/s, 1 d/s), step buttons (ChevronLeft/Right with tooltips "1 h, Shift = 1 day"), the cursor time large in mono ("Tue 17 Nov 2026 · 00:00 UTC") plus "day 3 of 30"; legend as compact dots on the right; keyboard help behind a "?" `IconButton` tooltip with `Kbd`s. Body: a 180 px label column per row: site name (gold if selected) + tiny lane labels (Sun, Earth, Both, Comms) aligned with the lanes.

**First visit.** Welcome card centred over the globe (blurred backdrop, dismissible, remembered in localStorage `llsn.welcome.v1`, never shown when the URL has a share hash): title "Where on the Moon do the Sun and Earth stay up?", two lines on what the app does, three example cards that run a query, buttons "Take the 60-second tour" and "Explore on my own", link "How we know it's right".

**Loading.** A splash over the globe area until the engine is ready and the first ranking is in: logo, a short step list (Ephemeris, Terrain, Region index, Ranking 72,324 cells) driven by the existing progress events, then fade out. No black screen with stray dots.

**Phone (< 900 px).** No horizontal page scroll at 390 px. Top bar collapses to logo + Ask (icon expands to a full-width field) + overflow menu; query strip scrolls horizontally; globe takes ~50vh; below it a bottom sheet with tabs Results | Site | Timeline; the inspector becomes a full-height sheet when a site is selected; first-person view fills the screen.

## Ownership for the implementation pass

Three engineers work at the same time. Re-read a file right before every edit. `store.ts` is shared: add only your own fields/actions, small and clearly named, and don't reformat it.

- **Shell**: `App.tsx`, `main.tsx`, `QueryBar.tsx`, `editors.tsx`, `ValidationModal.tsx`, `Tour.tsx`, new `Welcome.tsx` and `Splash.tsx`, `shell.css`, `responsive.css` (app grid and phone layout), legacy rules in `styles.css` for the top bar, chips, modals, toasts, tour.
- **Panels**: `LeftPanel.tsx`, `Drawer.tsx`, `PowerPanel.tsx`, `TraversePanel.tsx`, `EllipsePanel.tsx`, `ReplayTab.tsx`, `DiffTab.tsx`, `HorizonPlot.tsx`, `MetricSelectAll.tsx`, new `lib/places.ts` (nearest named place), `panels.css`, legacy rules in `styles.css` for the left panel and drawer.
- **Globe & timeline**: `globe/*`, `Timeline.tsx`, `FirstPerson.tsx`, `globe.css`, legacy rules in `styles.css` for the globe, timeline and first-person view.
- `design.css` and the primitives in `ui.tsx`: anyone may add a primitive or fix one, but append rather than rewrite and keep existing APIs.
