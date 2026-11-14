// Moon-centred orbit camera: replaces Cesium's default ScreenSpaceCameraController.
//
// Camera model (all in the Moon-fixed frame, Moon centre at the origin):
//   n   unit vector from the Moon's centre to the surface point shown at the screen centre (the "pivot")
//   u   unit tangent at n that points "up" on screen (heading); orthogonal to n
//   t   tilt from nadir (0 = top-down, view axis through the Moon's centre)
//   d   distance from the pivot to the camera (= altitude when t = 0)
//   hp  pivot height above the reference sphere (only used while tilted, so tilting pivots on the real ground)
// Camera position = pivot + d (cos t n - sin t u); it looks at the pivot, screen-up = sin t n + cos t u.
// Every state change goes through commit(), which clamps the camera above the local terrain, then writes the camera.
import {
  Cartesian2, Cartesian3, Cartographic, Ellipsoid, Math as CMath, ScreenSpaceEventType, type Viewer,
} from 'cesium';
import { getEngine } from '../engine/client.ts';
import { isFirstPersonActive, onFirstPersonChange } from './cameraMode.ts';

export interface OrbitControls {
  /** Turn user input on/off (the first-person view calls this too; also off automatically while isFirstPersonActive()). */
  setEnabled(on: boolean): void;
  /** Zoom along the view axis; factor > 1 zooms in, < 1 zooms out. */
  zoomBy(factor: number): void;
  /** Animate to top-down, north-up (keeps the centre point and zoom). */
  resetView(): void;
  /** Animate the tilt (degrees from nadir, 0 = top-down) around the screen-centre surface point. */
  setTilt(deg: number): void;
  destroy(): void;
  // ---- extras used by Globe.tsx ----
  /** Terrain-safe flight to a surface point. Resolves when the flight ends (or is superseded). */
  flyTo(o: FlyOptions): Promise<void>;
  /** Top-down over the south pole at a regional altitude. */
  home(instant?: boolean): Promise<void>;
  /** Current tilt from nadir, degrees. */
  getTilt(): number;
  /** True while the user is dragging / pinching (used to skip hover picking). */
  isInteracting(): boolean;
  /** Re-derive the orbit state from the actual camera (after the camera was moved externally, e.g. share-link restore). */
  syncFromCamera(): void;
}

export interface FlyOptions {
  lat: number; lon: number;
  /** distance from the target to the camera, metres */
  range?: number;
  /** degrees from nadir (default 0) */
  tilt?: number;
  /** degrees clockwise from north that point "up" on screen (default 0) */
  heading?: number;
  duration?: number;
  instant?: boolean;
  /** explicit screen-up tangent (overrides heading); used by the pole view */
  up?: Cartesian3;
}

const MOON = Ellipsoid.MOON;
const RM = MOON.maximumRadius;
const MAX_D = 6 * RM;
const MIN_D = 120;
const CLEAR = 250; // m of clearance above the highest terrain near the camera
const CLICK_PX = 5;
const MAX_TILT = CMath.toRadians(75);
export const POLE_RANGE = 6.0e5;

let current: OrbitControls | null = null;
export function getOrbitControls(): OrbitControls | null { return current; }

type V = Cartesian3;
const v3 = (x: number, y: number, z: number) => new Cartesian3(x, y, z);
const dot = (a: V, b: V) => Cartesian3.dot(a, b);
const cross = (a: V, b: V) => Cartesian3.cross(a, b, new Cartesian3());
const scale = (a: V, s: number) => Cartesian3.multiplyByScalar(a, s, new Cartesian3());
const add = (a: V, b: V) => Cartesian3.add(a, b, new Cartesian3());
const sub = (a: V, b: V) => Cartesian3.subtract(a, b, new Cartesian3());
const len = (a: V) => Cartesian3.magnitude(a);
const unit = (a: V) => Cartesian3.normalize(a, new Cartesian3());
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

function rotate(v: V, axis: V, ang: number): V {
  const c = Math.cos(ang), s = Math.sin(ang);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}
/** project u into the tangent plane of n and normalise (robust fallback if u is parallel to n) */
function tangent(n: V, u: V): V {
  const p = sub(u, scale(n, dot(u, n)));
  if (len(p) > 1e-9) return unit(p);
  const alt = Math.abs(n.x) < 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  return unit(sub(alt, scale(n, dot(alt, n))));
}
function dirOf(latDeg: number, lonDeg: number): V {
  const la = CMath.toRadians(latDeg), lo = CMath.toRadians(lonDeg);
  return v3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
}
/** north tangent at n, or null at the poles where it is undefined */
function northAt(n: V): V | null {
  const p = sub(v3(0, 0, 1), scale(n, n.z));
  return len(p) < 1e-6 ? null : unit(p);
}
function headingUp(n: V, headingDeg: number): V {
  const north = northAt(n) ?? tangent(n, v3(1, 0, 0));
  const east = unit(cross(north, n));
  const h = CMath.toRadians(headingDeg);
  return unit(add(scale(north, Math.cos(h)), scale(east, Math.sin(h))));
}
const latOf = (n: V) => Math.asin(clamp(n.z, -1, 1));
const lonOf = (n: V) => Math.atan2(n.y, n.x);
const ease = (f: number) => (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);

interface State { n: V; u: V; t: number; d: number; hp: number }
const cloneState = (s: State): State => ({ n: Cartesian3.clone(s.n), u: Cartesian3.clone(s.u), t: s.t, d: s.d, hp: s.hp });

interface Anim { t0: number; dur: number; from: State; to: State; axis: V; ang: number; delta: number; dPeak: number }

interface Known { w: number; s: number; e: number; n: number; max: number }

export function installOrbitControls(viewer: Viewer): OrbitControls {
  const scene = viewer.scene;
  const camera = viewer.camera;
  const canvas = scene.canvas;
  const ssc = scene.screenSpaceCameraController;
  ssc.enableInputs = false;
  ssc.enableRotate = ssc.enableZoom = ssc.enableTilt = ssc.enableLook = ssc.enableTranslate = false;
  ssc.minimumZoomDistance = 1;
  ssc.maximumZoomDistance = 1e9;
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  const prevTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = 'none';

  let userEnabled = true;
  const active = () => userEnabled && !isFirstPersonActive() && !viewer.isDestroyed();

  const st: State = { n: v3(0, 0, -1), u: v3(1, 0, 0), t: 0, d: POLE_RANGE, hp: 0 };
  let dTarget = st.d;
  let anim: Anim | null = null;
  let flightToken = 0;
  let headingLocked = false; // the user turned the heading on purpose: do not snap back to north-up
  let hpFrozen = true;
  let dirty = true;
  let last: { p: Cartesian3; d: Cartesian3 } | null = null;
  let lastFrame = performance.now();

  // ---------------- terrain height lookups ----------------
  const known: Known[] = [];
  const exag = () => scene.verticalExaggeration || 1;
  const carto = new Cartographic();
  function fallbackMax(latR: number, lonR: number): number | undefined {
    const la = CMath.toDegrees(latR), lo = CMath.toDegrees(lonR);
    let m: number | undefined;
    for (const k of known) {
      if (la >= k.s && la <= k.n && (lo >= k.w && lo <= k.e)) m = Math.max(m ?? -Infinity, k.max);
    }
    return m === undefined ? undefined : m * exag();
  }
  /** terrain height (in the exaggerated scene) at a unit direction, from the rendered globe, else the sampled fallback */
  function heightAt(dir: V): number | undefined {
    carto.latitude = latOf(dir); carto.longitude = lonOf(dir); carto.height = 0;
    const h = scene.globe.getHeight(carto);
    if (h !== undefined && Number.isFinite(h)) return h;
    return fallbackMax(carto.latitude, carto.longitude);
  }
  /** highest terrain at dir and on a small ring around it (ringM metres) */
  function ringGround(dir: V, ringM: number): number {
    const e1 = tangent(dir, Math.abs(dir.z) < 0.9 ? v3(0, 0, 1) : v3(1, 0, 0));
    const e2 = cross(dir, e1);
    const a = ringM / RM;
    let m = -Infinity;
    const c = heightAt(dir);
    if (c !== undefined) m = c;
    for (let i = 0; i < 4; i++) {
      const th = (i * Math.PI) / 2;
      const p = unit(add(dir, add(scale(e1, Math.sin(a) * Math.cos(th)), scale(e2, Math.sin(a) * Math.sin(th)))));
      const h = heightAt(p);
      if (h !== undefined && h > m) m = h;
    }
    return Number.isFinite(m) ? m : 0;
  }
  let prefetching = false, lastPrefetch = 0;
  /** sample the engine's heights in a box around a point; cache the max and return {max, centre} (scene heights, exaggerated) */
  async function sampleBox(latDeg: number, lonDeg: number, halfM: number): Promise<{ max: number; centre: number }> {
    const halfLat = (halfM / RM) * (180 / Math.PI);
    const cosLat = Math.max(0.02, Math.cos(CMath.toRadians(latDeg)));
    let halfLon = halfLat / cosLat;
    let w = lonDeg - halfLon, e = lonDeg + halfLon;
    if (halfLon >= 90 || w < -180 || e > 180) { halfLon = 180; w = -180; e = 180; }
    const s = Math.max(-90, latDeg - halfLat), n = Math.min(90, latDeg + halfLat);
    const N = 13;
    const hs = await getEngine().sampleHeights(w, s, e, n, N, N);
    let max = -Infinity;
    for (const x of Array.from(hs)) if (Number.isFinite(x) && x > max) max = x;
    if (!Number.isFinite(max)) max = 0;
    const mid = hs[(N >> 1) * N + (N >> 1)];
    known.push({ w, s, e, n, max });
    if (known.length > 10) known.shift();
    return { max: max * exag(), centre: (Number.isFinite(mid) ? mid : 0) * exag() };
  }
  function maybePrefetch(dir: V, altM: number) {
    const now = performance.now();
    if (prefetching || now - lastPrefetch < 700) return;
    prefetching = true; lastPrefetch = now;
    sampleBox(CMath.toDegrees(latOf(dir)), CMath.toDegrees(lonOf(dir)), clamp(altM * 3, 4000, 60000))
      .then(() => { dirty = true; scene.requestRender(); }).catch(() => { /* flat */ }).finally(() => { prefetching = false; });
  }

  // ---------------- state -> camera ----------------
  const hpEff = () => st.hp;
  function cameraPose(s: State) {
    const r = RM + hpEff();
    const pivot = scale(s.n, r);
    const off = add(scale(s.n, s.d * Math.cos(s.t)), scale(s.u, -s.d * Math.sin(s.t)));
    const pos = add(pivot, off);
    const dir = unit(scale(off, -1));
    const up = add(scale(s.n, Math.sin(s.t)), scale(s.u, Math.cos(s.t)));
    return { pos, dir, up };
  }
  function clampClearance() {
    for (let it = 0; it < 2; it++) {
      const r = RM + hpEff();
      const pos = cameraPose(st).pos;
      const radius = len(pos);
      const alt = radius - RM;
      if (alt > 12000 * exag() + 4000) return; // nothing on the Moon is that tall
      const dir = scale(pos, 1 / radius);
      if (heightAt(dir) === undefined) maybePrefetch(dir, alt);
      const g = ringGround(dir, clamp(alt * 0.5, 150, 1500));
      const need = RM + g + CLEAR;
      if (radius >= need) return;
      // |pivot + d*(cos t n - sin t u)| = need  ->  d^2 + 2 r cos t d + r^2 - need^2 = 0
      const c = Math.cos(st.t), s = Math.sin(st.t);
      const nd = -r * c + Math.sqrt(Math.max(0, need * need - r * r * s * s));
      if (!(nd > st.d)) return;
      st.d = nd;
      if (dTarget < nd) dTarget = nd;
      dirty = true;
    }
  }
  function commit() {
    st.t = clamp(st.t, 0, MAX_TILT);
    st.d = clamp(st.d, MIN_D, MAX_D);
    clampClearance();
    st.d = clamp(st.d, MIN_D, MAX_D);
    const { pos, dir, up } = cameraPose(st);
    camera.setView({ destination: pos, orientation: { direction: dir, up } });
    last = { p: Cartesian3.clone(camera.positionWC), d: Cartesian3.clone(camera.directionWC) };
    dirty = false;
    scene.requestRender();
  }
  function syncFromCamera() {
    const C = Cartesian3.clone(camera.positionWC), D = Cartesian3.clone(camera.directionWC), U = Cartesian3.clone(camera.upWC);
    anim = null; flightToken++;
    const b = dot(C, D), c = dot(C, C) - RM * RM, disc = b * b - c;
    let n: V, d: number, t: number;
    if (disc > 0 && b < 0) {
      const s = -b - Math.sqrt(disc);
      const P = add(C, scale(D, s));
      n = unit(P); d = s; t = Math.acos(clamp(-dot(D, n), -1, 1));
    } else {
      n = unit(C); d = len(C) - RM; t = 0;
    }
    const u = t > 0.02 ? tangent(n, D) : tangent(n, U);
    st.n = n; st.u = u; st.t = Math.min(t, MAX_TILT); st.d = Math.max(d, MIN_D); st.hp = 0;
    dTarget = st.d; hpFrozen = true; dirty = true;
    commit();
  }

  // ---------------- animation ----------------
  function animateTo(to: State, dur: number) {
    const from = cloneState(st);
    let axis = cross(from.n, to.n);
    let ang = Math.atan2(len(axis), dot(from.n, to.n));
    if (len(axis) < 1e-9) {
      if (dot(from.n, to.n) > 0) { axis = from.u; ang = 0; } else { axis = from.u; ang = Math.PI; }
    } else axis = unit(axis);
    const ur = rotate(from.u, axis, ang);
    const u1 = tangent(to.n, to.u);
    const delta = Math.atan2(dot(to.n, cross(ur, u1)), dot(ur, u1));
    const dPeak = Math.max(from.d, to.d, ang * RM * 0.8);
    anim = { t0: performance.now(), dur: Math.max(0.05, dur) * 1000, from, to: { ...to, u: u1 }, axis, ang, delta, dPeak };
    dTarget = to.d;
    hpFrozen = true;
    scene.requestRender();
  }
  function stepAnim(now: number): boolean {
    if (!anim) return false;
    const f = clamp((now - anim.t0) / anim.dur, 0, 1), e = ease(f);
    const a = anim;
    if (f >= 1) { st.n = a.to.n; st.u = a.to.u; st.t = a.to.t; st.d = a.to.d; st.hp = a.to.hp; anim = null; dirty = true; return true; }
    st.n = rotate(a.from.n, a.axis, a.ang * e);
    const ur = rotate(a.from.u, a.axis, a.ang * e);
    st.u = tangent(st.n, rotate(ur, st.n, a.delta * e));
    st.t = a.from.t + (a.to.t - a.from.t) * e;
    st.hp = a.from.hp + (a.to.hp - a.from.hp) * e;
    const l0 = Math.log(a.from.d), l1 = Math.log(a.to.d);
    st.d = Math.exp(l0 + (l1 - l0) * e + Math.sin(Math.PI * e) * Math.max(0, Math.log(a.dPeak / Math.max(a.from.d, a.to.d))));
    dirty = true;
    return true;
  }

  // ---------------- per-frame ----------------
  function onPreRender() {
    if (!active()) { lastFrame = performance.now(); return; }
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    // the camera was moved by someone else (Cesium flight, share-link restore, first-person mode): adopt it
    if (last) {
      const moved = Cartesian3.distance(camera.positionWC, last.p) > 0.5 || dot(camera.directionWC, last.d) < 1 - 1e-9;
      if (moved && !anim) syncFromCamera();
    }
    let busy = stepAnim(now);
    if (!anim && Math.abs(Math.log(dTarget / st.d)) > 1e-3) {
      st.d *= Math.exp(Math.log(dTarget / st.d) * (1 - Math.exp(-dt / 0.09)));
      dirty = busy = true;
    } else if (!anim && st.d !== dTarget) { st.d = dTarget; dirty = true; }
    if (!anim && !hpFrozen) {
      // the pivot follows the ground when close (so top-down zoom can go below the reference sphere in basins), the sphere when far
      const g = st.d < 3e5 ? heightAt(st.n) : 0;
      if (g !== undefined && Math.abs(g - st.hp) > 0.5) { st.hp += (g - st.hp) * (1 - Math.exp(-dt / 0.25)); dirty = busy = true; }
    }
    if (dirty || !last) commit();
    else if (st.d < 6e4 * exag()) { // cheap re-check when terrain tiles refine under a low camera
      const before = st.d; clampClearance(); if (st.d !== before) commit();
    }
    if (busy) scene.requestRender();
  }
  scene.preRender.addEventListener(onPreRender);

  // ---------------- input ----------------
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: 'none' | 'rotate' | 'tilt' | 'pinch' = 'none';
  let dragging = false;
  let downX = 0, downY = 0, prevX = 0, prevY = 0;
  let pinchDist = 0, pinchAng = 0;
  const rectXY = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function sphereHit(x: number, y: number): V | null {
    const ray = camera.getPickRay(new Cartesian2(x, y));
    if (!ray) return null;
    const o = ray.origin, d = ray.direction;
    const b = dot(o, d), c = dot(o, o) - RM * RM, disc = b * b - c;
    if (disc <= 0 || b >= 0) return null;
    const p = add(o, scale(d, -b - Math.sqrt(disc)));
    // too close to the limb: tracking is unstable there
    if (dot(unit(p), scale(d, -1)) < 0.18) return null;
    return p;
  }
  function applyWorldRotation(axis: V, ang: number) {
    st.n = unit(rotate(st.n, axis, ang));
    st.u = tangent(st.n, rotate(st.u, axis, ang));
  }
  function dragRotate(x: number, y: number) {
    const a = sphereHit(prevX, prevY), b = sphereHit(x, y);
    if (a && b) {
      // rotate the camera so the surface point that was under the previous pointer is now under the current one
      const ax = cross(b, a);
      const l = len(ax);
      if (l > 1e-12) applyWorldRotation(scale(ax, 1 / l), Math.atan2(l, dot(a, b)));
    } else {
      // pointer left the disc (or hugs the limb): angular speed proportional to altitude
      const alt = Math.max(1, len(camera.positionWC) - RM);
      const fovy = (camera.frustum as unknown as { fovy: number }).fovy ?? 1;
      const perPx = (2 * Math.tan(fovy / 2) * alt) / Math.max(1, canvas.clientHeight) / RM;
      const k = Math.min(perPx, 0.01);
      const right = Cartesian3.clone(camera.rightWC), up = Cartesian3.clone(camera.upWC);
      const camR = right, camU = up;
      // world turns so the surface follows the pointer; camera does the inverse
      let ang = (x - prevX) * k;
      if (ang) applyWorldRotation(camU, -ang);
      ang = (y - prevY) * k;
      if (ang) applyWorldRotation(camR, -ang);
    }
    anim = null; hpFrozen = false;
    commit();
  }
  function dragTilt(x: number, y: number) {
    const dx = x - prevX, dy = y - prevY;
    st.u = tangent(st.n, rotate(st.u, st.n, CMath.toRadians(dx * 0.35)));
    st.t = clamp(st.t - CMath.toRadians(dy * 0.3), 0, MAX_TILT);
    headingLocked = true; anim = null; hpFrozen = false;
    commit();
  }
  const pinchState = () => {
    const [a, b] = Array.from(pointers.values());
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
  };
  function onDown(e: PointerEvent) {
    if (!active()) return;
    const p = rectXY(e);
    pointers.set(e.pointerId, p);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    if (pointers.size === 1) {
      downX = prevX = p.x; downY = prevY = p.y; dragging = false;
      mode = e.button === 2 || e.button === 1 || (e.button === 0 && (e.ctrlKey || e.shiftKey || e.metaKey)) ? 'tilt' : 'rotate';
    } else if (pointers.size === 2) {
      mode = 'pinch'; dragging = true;
      const s = pinchState(); pinchDist = s.dist; pinchAng = s.ang;
    }
  }
  function onMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId) || !active()) return;
    const p = rectXY(e);
    pointers.set(e.pointerId, p);
    if (mode === 'pinch' && pointers.size >= 2) {
      const s = pinchState();
      if (pinchDist > 1 && s.dist > 1) {
        const ratio = s.dist / pinchDist;
        anim = null;
        st.d = dTarget = clamp(st.d / ratio, MIN_D, MAX_D);
      }
      let da = s.ang - pinchAng;
      if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
      st.u = tangent(st.n, rotate(st.u, st.n, da));
      headingLocked = true;
      pinchDist = s.dist; pinchAng = s.ang;
      commit();
      return;
    }
    if (mode === 'none' || pointers.size !== 1) return;
    if (!dragging) {
      if (Math.hypot(p.x - downX, p.y - downY) < (e.pointerType === 'touch' ? CLICK_PX + 3 : CLICK_PX)) return;
      dragging = true; prevX = downX; prevY = downY;
    }
    if (mode === 'rotate') dragRotate(p.x, p.y); else dragTilt(p.x, p.y);
    prevX = p.x; prevY = p.y;
    e.preventDefault();
  }
  function onUp(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const wasRotate = mode === 'rotate' && dragging;
    if (pointers.size === 0) {
      mode = 'none'; dragging = false;
      if (wasRotate && !headingLocked && st.t < 0.1 && Math.abs(latOf(st.n)) < CMath.toRadians(80)) {
        const north = northAt(st.n);
        if (north) animateTo({ ...cloneState(st), u: north }, 0.45);
      }
    } else { mode = 'none'; dragging = false; }
  }
  function onWheel(e: WheelEvent) {
    if (!active()) return;
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
    dy = clamp(dy, -300, 300);
    const k = e.ctrlKey ? 0.009 : 0.0016; // ctrl+wheel = trackpad pinch
    anim = null; flightToken++;
    dTarget = clamp(dTarget * Math.exp(dy * k), MIN_D, MAX_D);
    hpFrozen = false;
    scene.requestRender();
  }
  function onDblClick(e: MouseEvent) {
    if (!active()) return;
    e.preventDefault();
    controls.resetView();
  }
  const onContext = (e: Event) => e.preventDefault();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('contextmenu', onContext);
  const offFp = onFirstPersonChange((fp) => { if (!fp && userEnabled) { pointers.clear(); mode = 'none'; dragging = false; syncFromCamera(); } });

  // ---------------- API ----------------
  async function flyTo(o: FlyOptions): Promise<void> {
    const my = ++flightToken;
    const tilt = CMath.toRadians(clamp(o.tilt ?? 0, 0, 75));
    const range = clamp(o.range ?? 20000, MIN_D, MAX_D);
    const n = dirOf(o.lat, o.lon);
    const u = o.up ? tangent(n, o.up) : headingUp(n, o.heading ?? 0);
    let centre = 0, ground = 0;
    try {
      const half = clamp(range * 0.8, 600, 8000);
      // the engine worker can be busy with a shadow patch: do not hold the flight longer than ~1.2 s (the per-frame clamp covers the rest)
      const r = await Promise.race([sampleBox(o.lat, o.lon, half), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('slow')), 1200))]);
      centre = r.centre; ground = r.max;
      const g2 = heightAt(n);
      if (g2 !== undefined) { centre = Math.max(centre, g2); ground = Math.max(ground, g2); }
    } catch { /* flat */ }
    if (my !== flightToken || viewer.isDestroyed()) return;
    const hp = range < 3e5 ? centre : 0;
    // distance so the camera ends >= CLEAR above the highest terrain near the target
    const r0 = RM + hp;
    const need = RM + ground + CLEAR;
    const c = Math.cos(tilt), s = Math.sin(tilt);
    const dMin = -r0 * c + Math.sqrt(Math.max(0, need * need - r0 * r0 * s * s));
    const to: State = { n, u, t: tilt, d: clamp(Math.max(range, dMin), MIN_D, MAX_D), hp };
    headingLocked = false;
    if (!active()) return;
    if (o.instant) {
      anim = null; Object.assign(st, to); dTarget = st.d; hpFrozen = true; commit();
      return;
    }
    const ang = Math.acos(clamp(dot(st.n, n), -1, 1));
    const dur = o.duration ?? clamp(0.9 + 0.7 * ang + 0.2 * Math.abs(Math.log(to.d / st.d)), 0.9, 3);
    animateTo(to, dur);
    await new Promise<void>((res) => {
      const check = () => { if (!anim || my !== flightToken || viewer.isDestroyed()) res(); else setTimeout(check, 80); };
      check();
    });
  }
  const controls: OrbitControls = {
    setEnabled(on) {
      const was = active();
      userEnabled = on;
      if (!on) { pointers.clear(); mode = 'none'; dragging = false; anim = null; flightToken++; }
      else if (!was && active()) syncFromCamera();
    },
    zoomBy(factor) {
      if (!active() || !(factor > 0)) return;
      anim = null; flightToken++;
      dTarget = clamp(dTarget / factor, MIN_D, MAX_D);
      hpFrozen = false;
      scene.requestRender();
    },
    resetView() {
      if (!active()) return;
      flightToken++;
      const north = northAt(st.n);
      headingLocked = false;
      animateTo({ n: Cartesian3.clone(st.n), u: north && Math.abs(latOf(st.n)) < CMath.toRadians(85) ? north : st.u, t: 0, d: st.d, hp: st.hp }, 0.6);
    },
    setTilt(deg) {
      if (!active()) return;
      flightToken++;
      const t = CMath.toRadians(clamp(deg, 0, 75));
      const g = st.d < 3e5 ? (heightAt(st.n) ?? st.hp) : 0;
      animateTo({ n: Cartesian3.clone(st.n), u: Cartesian3.clone(st.u), t, d: st.d, hp: g }, 0.55);
    },
    flyTo,
    home: (instant) => flyTo({ lat: -90, lon: 0, range: POLE_RANGE, tilt: 0, up: v3(1, 0, 0), instant }),
    getTilt: () => CMath.toDegrees(st.t),
    isInteracting: () => dragging,
    syncFromCamera: () => { if (active()) syncFromCamera(); },
    destroy() {
      flightToken++; anim = null;
      scene.preRender.removeEventListener(onPreRender);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.style.touchAction = prevTouchAction;
      offFp();
      if (current === controls) current = null;
    },
  };
  current = controls;
  syncFromCamera();
  return controls;
}
