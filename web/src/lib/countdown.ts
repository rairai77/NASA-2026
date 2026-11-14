// Countdowns and cursor lookups on a VisResult.
import type { SkyEvent, VisResult } from '../engine/api.ts';
import { fmtDur } from './time.ts';

export interface Sample {
  sunAz: number; sunEl: number; sunFrac: number; earthAz: number; earthEl: number;
  earthUp: boolean; eclipseFrac: number; sunUp: boolean;
}

function lerpAngle(a: number, b: number, w: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * w + 360) % 360;
}

/** Linear interpolation of the series at time t (clamped to the series range). */
export function sampleAt(v: VisResult | undefined, t: number): Sample | null {
  const n = v?.t.length ?? 0;
  if (!v || n === 0) return null;
  const step = n > 1 ? v.t[1] - v.t[0] : 900;
  const f = Math.min(n - 1, Math.max(0, (t - v.t[0]) / step));
  const i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1), w = f - i0;
  const l = (a: Float32Array) => a[i0] * (1 - w) + a[i1] * w;
  const sunFrac = l(v.sunFrac);
  return {
    sunAz: lerpAngle(v.sunAz[i0], v.sunAz[i1], w), sunEl: l(v.sunEl), sunFrac,
    earthAz: lerpAngle(v.earthAz[i0], v.earthAz[i1], w), earthEl: l(v.earthEl),
    earthUp: v.earthUp[i0] === 1, eclipseFrac: l(v.eclipseFrac), sunUp: v.sunFrac[i0] >= 0.5,
  };
}

function nextEvent(events: SkyEvent[], t: number, kind: SkyEvent['kind']): SkyEvent | undefined {
  return events.find((e) => e.t > t && e.kind === kind);
}

export interface Countdown { sun: string; earth: string; sunSoon: boolean; earthSoon: boolean }

export function countdowns(v: VisResult | undefined, t: number, windowEnd: number): Countdown | null {
  const s = sampleAt(v, t);
  if (!v || !s) return null;
  const mk = (up: boolean, setKind: SkyEvent['kind'], riseKind: SkyEvent['kind'], noun: string) => {
    const e = nextEvent(v.events, t, up ? setKind : riseKind);
    const word = up ? `${noun}set` : `${noun}rise`;
    if (e) return { text: `${word} in ${fmtDur(e.t - t)}`, soon: e.t - t < 6 * 3600 };
    const rest = fmtDur(windowEnd - t);
    return { text: up ? `${noun} stays up for ≥ ${rest}` : `No ${noun.toLowerCase()}rise within window`, soon: false };
  };
  const sun = mk(s.sunUp, 'sunset', 'sunrise', 'Sun');
  const earth = mk(s.earthUp, 'earthset', 'earthrise', 'Earth');
  return { sun: sun.text, earth: earth.text, sunSoon: sun.soon, earthSoon: earth.soon };
}
