// MockEngine: synthetic but physically plausible data so the whole UI works without
// the WASM engine or the data pipeline. Geometry (sub-solar point, libration, parallax,
// topocentric az/el, disc-visibility formula) follows CONTRACTS but ephemerides are
// analytic approximations, NOT real data.
import type {
  CuratedSite, EllipseArgs, EllipseResult, EngineApi, HorizonResult, InitInfo, Metrics, Mission,
  Progress, Query, RankEntry, RankResult, Site, SkyEvent, SunEarth, VisResult,
} from './api.ts';
import { MOON_R_M } from './api.ts';
import { loadFaults, loadMissions, loadSites } from './catalog.ts';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const R_KM = MOON_R_M / 1000;
const SYNODIC_S = 29.530589 * 86400;
const T_NEW = Date.UTC(2026, 10, 9, 13, 2) / 1000; // a new Moon
const T_VERNAL = Date.UTC(2026, 2, 20) / 1000;
const YEAR_S = 365.2422 * 86400;
const EARTH_DIST_KM = 384400;
const SUN_R_DEG = 0.2666;
const EARTH_R_DEG_NOMINAL = 0.95;

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const wrap360 = (a: number) => ((a % 360) + 360) % 360;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Unit vector toward the Sun in MOON_ME (Sun at infinity, no parallax). */
export function sunVec(t: number): V3 {
  const lon = (180 - (360 * (t - T_NEW)) / SYNODIC_S) * D2R;
  const lat = 1.54 * Math.sin((2 * Math.PI * (t - T_VERNAL)) / YEAR_S) * D2R;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/** Earth position (km) from the Moon centre in MOON_ME: near +x, librating. */
export function earthPosKm(t: number): V3 {
  const lon = 7.6 * Math.sin((2 * Math.PI * t) / (27.5546 * 86400) + 0.9) * D2R;
  const lat = 6.6 * Math.sin((2 * Math.PI * t) / (27.2122 * 86400) + 2.1) * D2R;
  const d = EARTH_DIST_KM * (1 + 0.055 * Math.cos((2 * Math.PI * t) / (27.5546 * 86400)));
  return [d * Math.cos(lat) * Math.cos(lon), d * Math.cos(lat) * Math.sin(lon), d * Math.sin(lat)];
}

interface Basis { up: V3; east: V3; north: V3; pos: V3 }
function basis(latDeg: number, lonDeg: number, heightM = 2): Basis {
  const la = latDeg * D2R, lo = lonDeg * D2R;
  const up: V3 = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const east: V3 = [-Math.sin(lo), Math.cos(lo), 0];
  const north: V3 = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const r = R_KM + heightM / 1000;
  return { up, east, north, pos: [up[0] * r, up[1] * r, up[2] * r] };
}
function azEl(b: Basis, v: V3): [number, number] {
  const n = Math.hypot(v[0], v[1], v[2]);
  const el = Math.asin(clamp(dot(v, b.up) / n, -1, 1)) * R2D;
  const az = wrap360(Math.atan2(dot(v, b.east), dot(v, b.north)) * R2D);
  return [az, el];
}

// ---- synthetic terrain-ish horizon -----------------------------------------------------
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
const RIDGE_K = 9;
const RIDGE_DIRS: V3[] = Array.from({ length: RIDGE_K + 1 }, (_, k) => {
  const a = hash(k + 1) * 2 * Math.PI, b = Math.acos(2 * hash(k + 50) - 1);
  return [Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b)];
});

export function mockHorizonAt(lat: number, lon: number, heightM = 2, nAz = 720): Float32Array {
  const b = basis(lat, lon, 0);
  const pos = b.pos; // km, smooth in space => nearby points have similar horizons
  const polar = clamp((Math.abs(lat) - 55) / 35, 0, 1);
  const mountain = 0.3 + 0.7 * (0.5 + 0.5 * Math.cos(dot(pos, RIDGE_DIRS[0]) / 14 + 1.3));
  const amp = (0.4 + 4.6 * polar) * mountain;
  const base = 0.15 * polar - 0.05;
  const ph: number[] = [];
  for (let k = 1; k <= RIDGE_K; k++) ph.push(hash(k + 9) * 6.283 + dot(pos, RIDGE_DIRS[k]) / (2.2 * Math.sqrt(k)));
  const out = new Float32Array(nAz);
  const hbonus = Math.log1p(heightM) * 0.03;
  for (let i = 0; i < nAz; i++) {
    const az = (i / nAz) * 2 * Math.PI;
    let n = 0;
    for (let k = 1; k <= RIDGE_K; k++) n += Math.cos(k * az - ph[k - 1]) / Math.pow(k, 0.85);
    n /= 2.4;
    const s = Math.max(0, n + 0.35);
    out[i] = base + amp * s * s * 1.5 - hbonus;
  }
  return out;
}

function interpHorizon(h: Float32Array, az: number): number {
  const n = h.length;
  const f = (wrap360(az) / 360) * n;
  const i0 = Math.floor(f) % n, i1 = (i0 + 1) % n, w = f - Math.floor(f);
  return h[i0] * (1 - w) + h[i1] * w;
}

function sunVisibleFraction(el: number, hz: number): number {
  const t = clamp((el - hz) / SUN_R_DEG, -1, 1);
  return 1 - (Math.acos(t) - t * Math.sqrt(1 - t * t)) / Math.PI;
}

function circleOverlapFrac(dDeg: number, rs: number, re: number): number {
  if (dDeg >= rs + re) return 0;
  if (dDeg <= re - rs) return 1;
  if (dDeg <= rs - re) return (re * re) / (rs * rs);
  const a = Math.acos(clamp((dDeg * dDeg + rs * rs - re * re) / (2 * dDeg * rs), -1, 1));
  const b = Math.acos(clamp((dDeg * dDeg + re * re - rs * rs) / (2 * dDeg * re), -1, 1));
  const area = rs * rs * a + re * re * b - 0.5 * Math.sqrt(Math.max(0, (-dDeg + rs + re) * (dDeg + rs - re) * (dDeg - rs + re) * (dDeg + rs + re)));
  return clamp(area / (Math.PI * rs * rs), 0, 1);
}

// ---- time series & metrics --------------------------------------------------------------
interface Skies { t: Float64Array; sun: Float32Array /*xyz*/; earth: Float32Array /*xyz km*/ }
function skies(tStart: number, tEnd: number, stepS: number): Skies {
  const n = Math.max(1, Math.floor((tEnd - tStart) / stepS));
  const t = new Float64Array(n), sun = new Float32Array(3 * n), earth = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    t[i] = tStart + i * stepS;
    const s = sunVec(t[i]); const e = earthPosKm(t[i]);
    sun.set(s, 3 * i); earth.set(e, 3 * i);
  }
  return { t, sun, earth };
}

function runMax(flags: ArrayLike<boolean | number>, stepH: number, want: boolean): number {
  let best = 0, cur = 0;
  for (let i = 0; i < flags.length; i++) {
    if (!!flags[i] === want) { cur++; if (cur > best) best = cur; } else cur = 0;
  }
  return best * stepH;
}

function computeVis(lat: number, lon: number, hz: Float32Array, sk: Skies, stepS: number, heightM: number): VisResult {
  const n = sk.t.length;
  const b = basis(lat, lon, heightM);
  const sunAz = new Float32Array(n), sunEl = new Float32Array(n), sunFrac = new Float32Array(n);
  const earthAz = new Float32Array(n), earthEl = new Float32Array(n), eclipse = new Float32Array(n);
  const earthUp = new Uint8Array(n);
  const sunUp = new Uint8Array(n), bothUp = new Uint8Array(n), eclipseFlag = new Uint8Array(n);
  let hmin = Infinity;
  for (let i = 0; i < hz.length; i++) hmin = Math.min(hmin, hz[i]);
  let sunHours = 0, earthHours = 0, bothHours = 0, eclHours = 0, sumEl = 0, minEl = Infinity, sumDisc = 0, energy = 0;
  const stepH = stepS / 3600;
  for (let i = 0; i < n; i++) {
    const sv: V3 = [sk.sun[3 * i], sk.sun[3 * i + 1], sk.sun[3 * i + 2]];
    const ev: V3 = [sk.earth[3 * i] - b.pos[0], sk.earth[3 * i + 1] - b.pos[1], sk.earth[3 * i + 2] - b.pos[2]];
    const [sa, se] = azEl(b, sv);
    const [ea, ee] = azEl(b, ev);
    sunAz[i] = sa; sunEl[i] = se; earthAz[i] = ea; earthEl[i] = ee;
    let frac = 0;
    if (se > hmin - SUN_R_DEG) frac = sunVisibleFraction(se, interpHorizon(hz, sa));
    const en = Math.hypot(ev[0], ev[1], ev[2]);
    const re = Math.asin(6371 / en) * R2D;
    const sepDeg = Math.acos(clamp(dot(sv, ev) / en, -1, 1)) * R2D;
    const ecl = sepDeg < SUN_R_DEG + re ? circleOverlapFrac(sepDeg, SUN_R_DEG, re) : 0;
    eclipse[i] = ecl;
    sunFrac[i] = frac * (1 - ecl);
    earthUp[i] = ee > interpHorizon(hz, ea) ? 1 : 0;
    const up = frac >= 0.5; // contract: Sun up when visible fraction >= 0.5
    sunUp[i] = up ? 1 : 0;
    bothUp[i] = up && earthUp[i] ? 1 : 0;
    eclipseFlag[i] = ecl > 0 && se > interpHorizon(hz, sa) - SUN_R_DEG ? 1 : 0;
    if (up) {
      sunHours += stepH; sumEl += se; minEl = Math.min(minEl, se); sumDisc += sunFrac[i];
      energy += 1361 * 0.28 * Math.max(0, Math.sin(se * D2R)) * sunFrac[i] * stepH;
    }
    if (earthUp[i]) earthHours += stepH;
    if (bothUp[i]) bothHours += stepH;
    if (eclipseFlag[i]) eclHours += stepH;
  }
  const winH = (n * stepS) / 3600;
  const longestDark = runMax(sunUp, stepH, false);
  const metrics: Metrics = {
    sun_hours: sunHours, sun_frac: winH ? sunHours / winH : 0,
    longest_sun_h: runMax(sunUp, stepH, true), longest_dark_h: longestDark,
    earth_hours: earthHours, longest_earth_h: runMax(earthUp, stepH, true),
    longest_no_earth_h: runMax(earthUp, stepH, false),
    both_hours: bothHours, longest_both_h: runMax(bothUp, stepH, true),
    mean_sun_el_deg: sunHours ? sumEl / (sunHours / stepH) : 0,
    min_sun_el_deg: Number.isFinite(minEl) ? minEl : 0,
    sun_disc_frac_mean: sunHours ? sumDisc / (sunHours / stepH) : 0,
    eclipse_hours: eclHours, energy_wh: energy, battery_wh_needed: (50 * longestDark) / 0.5,
  };
  const events: SkyEvent[] = [];
  for (let i = 1; i < n; i++) {
    const t = sk.t[i];
    if (sunUp[i] !== sunUp[i - 1]) events.push({ t, kind: sunUp[i] ? 'sunrise' : 'sunset' });
    if (earthUp[i] !== earthUp[i - 1]) events.push({ t, kind: earthUp[i] ? 'earthrise' : 'earthset' });
    if (eclipseFlag[i] !== eclipseFlag[i - 1]) events.push({ t, kind: eclipseFlag[i] ? 'eclipse_start' : 'eclipse_end' });
  }
  return { t: sk.t, sunAz, sunEl, sunFrac, earthAz, earthEl, earthUp, eclipseFrac: eclipse, metrics, events };
}

/** Pseudo static metrics (slope, elevation, distance to PSR / faults) smooth in space. */
function staticMetrics(lat: number, lon: number): Metrics {
  const p = basis(lat, lon, 0).pos;
  const w = (k: number, len: number, ph: number) => 0.5 + 0.5 * Math.cos(dot(p, RIDGE_DIRS[k]) / len + ph);
  const polar = clamp((Math.abs(lat) - 55) / 35, 0, 1);
  return {
    lat, lon,
    elev_m: Math.round(-1500 + 4200 * w(2, 20, 0.4) * (0.5 + polar)),
    slope_deg: 1.2 + (4 + 9 * polar) * w(3, 3.4, 1.1) * w(4, 9, 0.2),
    psr_dist_km: 0.3 + 9 * w(5, 7, 2),
    fault_dist_km: 0.5 + 40 * w(6, 11, 0.8),
  };
}

// ---- helpers over queries ----------------------------------------------------------------
export function parseWhen(s: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s) / 1000;
}
const ROUND: Record<string, number> = { h: 3, deg: 0.5, km: 0.5 };
function roundFor(metric: string): number {
  if (metric.endsWith('_h') || metric.endsWith('_hours')) return ROUND.h;
  if (metric.endsWith('_deg')) return ROUND.deg;
  if (metric.endsWith('_km')) return ROUND.km;
  if (metric.endsWith('_frac') || metric.endsWith('_mean')) return 0.01;
  return 0;
}
function passes(m: Metrics, q: Query): boolean {
  return q.filters.every((f) => {
    const v = m[f.metric];
    if (v === undefined || Number.isNaN(v)) return false;
    switch (f.op) {
      case '<': return v < f.value;
      case '<=': return v <= f.value;
      case '>': return v > f.value;
      default: return v >= f.value;
    }
  });
}
function sortEntries<T extends { metrics: Metrics }>(arr: T[], q: Query): T[] {
  const objs = q.objectives.length ? q.objectives : [{ metric: 'sun_hours', dir: 'max' as const }];
  if (q.mode === 'weighted' && q.weights && q.weights.length === objs.length) {
    const norm = objs.map((o) => {
      const vals = arr.map((a) => a.metrics[o.metric] ?? 0);
      return { lo: Math.min(...vals), hi: Math.max(...vals) };
    });
    const score = (a: T) => objs.reduce((s, o, i) => {
      const { lo, hi } = norm[i];
      const x = hi > lo ? ((a.metrics[o.metric] ?? 0) - lo) / (hi - lo) : 0;
      return s + q.weights![i] * (o.dir === 'max' ? x : 1 - x);
    }, 0);
    return [...arr].sort((a, b) => score(b) - score(a));
  }
  return [...arr].sort((a, b) => {
    for (const o of objs) {
      const r = roundFor(o.metric);
      let va = a.metrics[o.metric] ?? 0, vb = b.metrics[o.metric] ?? 0;
      if (r) { va = Math.round(va / r) * r; vb = Math.round(vb / r) * r; }
      if (va !== vb) return o.dir === 'max' ? vb - va : va - vb;
    }
    return 0;
  });
}

function distKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const ua = basis(a.lat, a.lon, 0).up, ub = basis(b.lat, b.lon, 0).up;
  return R_KM * Math.acos(clamp(dot(ua, ub), -1, 1));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function candidateGrid(q: Query, sites: Site[]): { id?: string; lat: number; lon: number }[] {
  const reg = q.region;
  if (reg.type === 'sites') return reg.ids.map((id) => sites.find((s) => s.id === id)).filter((s): s is Site => !!s).map((s) => ({ id: s.id, lat: s.lat, lon: s.lon }));
  const out: { lat: number; lon: number }[] = [];
  let lo: number, hi: number;
  if (reg.type === 'polar') { lo = Math.min(reg.min_lat, reg.max_lat); hi = Math.max(reg.min_lat, reg.max_lat); }
  else { lo = reg.lat - reg.radius_km / (R_KM * D2R); hi = reg.lat + reg.radius_km / (R_KM * D2R); }
  lo = Math.max(-90, lo); hi = Math.min(90, hi);
  const areaKm2 = 2 * Math.PI * R_KM * R_KM * Math.abs(Math.sin(hi * D2R) - Math.sin(lo * D2R));
  const spacing = Math.max(2.5, Math.sqrt(areaKm2 / 1400));
  const dLat = spacing / (R_KM * D2R);
  for (let lat = lo + dLat / 2; lat < hi; lat += dLat) {
    const circ = 2 * Math.PI * R_KM * Math.cos(lat * D2R);
    const nLon = Math.max(1, Math.round(circ / spacing));
    for (let j = 0; j < nLon; j++) {
      const lon = ((j + 0.5) / nLon) * 360 - 180;
      if (reg.type === 'circle' && distKm({ lat, lon }, reg) > reg.radius_km) continue;
      out.push({ lat, lon });
    }
  }
  return out;
}

export class MockEngine implements EngineApi {
  private base = '/';
  private sitesP?: Promise<Site[]>;
  private curatedP?: Promise<Record<string, CuratedSite>>;
  private notes: string[];
  constructor(notes: string[] = ['Mock engine: synthetic demo data']) { this.notes = notes; }

  async init(baseUrl: string): Promise<InitInfo> {
    this.base = baseUrl;
    return {
      threads: 1, crossOriginIsolated: typeof self !== 'undefined' && (self as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
      dataVersion: 'mock', mode: 'mock', notes: this.notes,
    };
  }
  sites(): Promise<Site[]> { return (this.sitesP ??= loadSites(this.base)); }
  missions(): Promise<Mission[]> { return loadMissions(this.base); }
  faults() { return loadFaults(this.base); }

  curated(): Promise<Record<string, CuratedSite>> {
    return (this.curatedP ??= (async () => {
      const sites = await this.sites();
      const out: Record<string, CuratedSite> = {};
      const t0 = parseWhen('2026-01-01');
      for (const s of sites) {
        const hz = mockHorizonAt(s.lat, s.lon);
        const monthly: CuratedSite['monthly'] = [];
        for (let m = 0; m < 12; m++) {
          const a = Date.UTC(2026, m, 1) / 1000, e = Date.UTC(2026, m + 1, 1) / 1000;
          const v = computeVis(s.lat, s.lon, hz, skies(a, e, 10800), 10800, 2);
          monthly.push({ month: `2026-${String(m + 1).padStart(2, '0')}`, ...(v.metrics as Record<string, number>) });
        }
        void t0;
        out[s.id] = { horizon: Array.from(hz), resolution_m: 20, site_elev_m: staticMetrics(s.lat, s.lon).elev_m ?? 0, monthly };
      }
      return out;
    })());
  }

  async horizon(lat: number, lon: number, heightM = 2): Promise<HorizonResult> {
    return {
      nAz: 720, elevDeg: mockHorizonAt(lat, lon, heightM, 720), resolutionM: 20, maxDistKm: Math.abs(lat) > 75 ? 300 : 150,
      siteElevM: staticMetrics(lat, lon).elev_m ?? 0, missingSamples: 0,
    };
  }

  async visibility(lat: number, lon: number, tStart: number, tEnd: number, opts?: { heightM?: number; stepS?: number; elevDeg?: Float32Array }): Promise<VisResult> {
    const stepS = opts?.stepS ?? 900;
    const hz = opts?.elevDeg ?? mockHorizonAt(lat, lon, opts?.heightM ?? 2);
    return computeVis(lat, lon, hz, skies(tStart, tEnd, stepS), stepS, opts?.heightM ?? 2);
  }

  async compare(points: { id: string; lat: number; lon: number }[], tStart: number, tEnd: number) {
    const out: Record<string, VisResult> = {};
    for (const p of points) out[p.id] = await this.visibility(p.lat, p.lon, tStart, tEnd);
    return out;
  }

  async rank(q: Query, onProgress?: (p: Progress) => void): Promise<RankResult> {
    const sites = await this.sites();
    const tS = parseWhen(q.window.start), tE = parseWhen(q.window.end);
    const cells = candidateGrid(q, sites);
    const coarseStep = Math.max(10800, Math.ceil((tE - tS) / 4000 / 10800) * 10800);
    const sk = skies(tS, tE, coarseStep);
    onProgress?.({ stage: 'Coarse screening', done: 0, total: cells.length });
    await sleep(30);
    const coarse: (RankEntry & { id?: string })[] = [];
    let passed = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const hz = mockHorizonAt(c.lat, c.lon, q.height_m);
      const v = computeVis(c.lat, c.lon, hz, sk, coarseStep, q.height_m);
      const m: Metrics = { ...v.metrics, ...staticMetrics(c.lat, c.lon) };
      if (passes(m, q)) { passed++; coarse.push({ rank: 0, cell: i, lat: c.lat, lon: c.lon, metrics: m, coarseMetrics: m, id: (c as { id?: string }).id }); }
      if (i % 200 === 0) { onProgress?.({ stage: 'Coarse screening', done: i, total: cells.length }); await sleep(0); }
    }
    let sorted = sortEntries(coarse, q);
    if (q.region.type !== 'sites') {
      const kept: typeof sorted = [];
      for (const c of sorted) {
        if (kept.length >= 50) break;
        if (kept.every((k) => distKm(k, c) >= q.min_separation_km)) kept.push(c);
      }
      sorted = kept;
    }
    onProgress?.({ stage: 'Refining at 15 min', done: 0, total: sorted.length });
    await sleep(30);
    const refined: RankEntry[] = [];
    const fineStep = Math.max(900, Math.ceil((tE - tS) / 40000 / 900) * 900);
    const skf = skies(tS, tE, fineStep);
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      const v = computeVis(c.lat, c.lon, mockHorizonAt(c.lat, c.lon, q.height_m), skf, fineStep, q.height_m);
      const m: Metrics = { ...v.metrics, ...staticMetrics(c.lat, c.lon) };
      if (passes(m, q)) refined.push({ ...c, metrics: m });
      if (i % 5 === 0) onProgress?.({ stage: 'Refining at 15 min', done: i, total: sorted.length });
    }
    const final = sortEntries(refined, q).slice(0, q.k).map((r, i) => ({ ...r, rank: i + 1 }));
    onProgress?.({ stage: 'Done', done: 1, total: 1 });
    return { results: final, considered: cells.length, passedFilters: passed, resolutionM: 20, model: 'mock' };
  }

  async ellipse(a: EllipseArgs): Promise<EllipseResult> {
    const stepS = a.stepS ?? 3600;
    const sk = skies(a.tStart, a.tEnd, stepS);
    const rot = a.rotDeg * D2R;
    const points: EllipseResult['points'] = [];
    for (let i = 0; i < a.n; i++) {
      const r = Math.sqrt((i + 0.5) / a.n), th = i * 2.399963;
      const x = a.semiMajorM * r * Math.cos(th), y = a.semiMinorM * r * Math.sin(th);
      // semi-major axis points along azimuth rotDeg (clockwise from north)
      const north = x * Math.cos(rot) - y * Math.sin(rot);
      const east = x * Math.sin(rot) + y * Math.cos(rot);
      const lat = a.lat + (north / MOON_R_M) * R2D;
      const lon = a.lon + (east / (MOON_R_M * Math.max(0.01, Math.cos(a.lat * D2R)))) * R2D;
      const v = computeVis(lat, lon, mockHorizonAt(lat, lon, a.heightM ?? 2), sk, stepS, a.heightM ?? 2);
      points.push({ lat, lon, metrics: { ...v.metrics, ...staticMetrics(lat, lon) } });
      if (i % 25 === 0) await sleep(0);
    }
    const summary: EllipseResult['summary'] = {};
    for (const k of Object.keys(points[0]?.metrics ?? {})) {
      const vals = points.map((p) => p.metrics[k] ?? 0).sort((x, y) => x - y);
      summary[k] = { min: vals[0], median: vals[Math.floor(vals.length / 2)], max: vals[vals.length - 1] };
    }
    return { points, summary };
  }

  async sampleHeights(_w: number, _s: number, _e: number, _n: number, w: number, h: number): Promise<Float32Array> {
    return new Float32Array(w * h);
  }

  async sunEarthAt(lat: number, lon: number, t: number): Promise<SunEarth> {
    const b = basis(lat, lon, 2);
    const sv = sunVec(t); const ep = earthPosKm(t);
    const ev: V3 = [ep[0] - b.pos[0], ep[1] - b.pos[1], ep[2] - b.pos[2]];
    const en = Math.hypot(...ev);
    const [sunAz, sunEl] = azEl(b, sv); const [earthAz, earthEl] = azEl(b, ev);
    const re = Math.asin(6371 / en) * R2D;
    const sep = Math.acos(clamp(dot(sv, ev) / en, -1, 1)) * R2D;
    return {
      sunAz, sunEl, earthAz, earthEl, sunRadiusDeg: SUN_R_DEG, earthRadiusDeg: re || EARTH_R_DEG_NOMINAL,
      eclipseFrac: circleOverlapFrac(sep, SUN_R_DEG, re), sunVecMe: sv, earthVecMe: [ev[0] / en, ev[1] / en, ev[2] / en],
    };
  }
}
