// Theme + small UI preferences. Dark is the default (a space app); the saved choice wins, then dark. localStorage access is always try/catch.
import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'llsn.theme';

export function readPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writePref(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* private mode */ }
}

let theme: Theme = 'dark';
const subs = new Set<() => void>();

export function getTheme(): Theme { return theme; }
function apply(t: Theme) {
  theme = t;
  cache = null;
  document.documentElement.setAttribute('data-theme', t);
  for (const f of subs) f();
}
export function setTheme(t: Theme) { writePref(KEY, t); apply(t); }
export function toggleTheme() { setTheme(theme === 'dark' ? 'light' : 'dark'); }
export function initTheme() { apply(readPref(KEY) === 'light' ? 'light' : 'dark'); }

/** Re-renders (and so re-draws canvases that list it as a dependency) when the theme changes. */
export function useTheme(): Theme {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, getTheme, () => 'dark' as Theme);
}

/** Resolved value of a CSS custom property at draw time (canvas cannot use var()). */
export function cssVar(name: string, fallback = '#888'): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export interface Palette { sun: string; earth: string; both: string; ecl: string; comms: string; marginal: string; gap: string; laneBg: string; cursor: string; text: string; text2: string; text3: string; surface0: string; surface1: string; border: string; danger: string }
let cache: Palette | null = null;
export function palette(): Palette {
  return cache ??= {
    sun: cssVar('--sun'), earth: cssVar('--earth'), both: cssVar('--both'), ecl: cssVar('--ecl'), comms: cssVar('--comms'), marginal: cssVar('--marginal'), gap: cssVar('--gap'),
    laneBg: cssVar('--lane-bg'), cursor: cssVar('--cursor'), text: cssVar('--text'), text2: cssVar('--text-2'), text3: cssVar('--text-3'),
    surface0: cssVar('--surface-0'), surface1: cssVar('--surface-1'), border: cssVar('--border'), danger: cssVar('--danger'),
  };
}
