// Real 3D first-person ("Stand here") camera inside the Cesium globe.
//
// The camera sits at the site (terrain height + observer height), the user looks around in place (drag / wheel / pinch),
// the Sun and Earth are drawn as depth-tested billboards along their true Moon-fixed (MOON_ME) directions so real terrain
// hides them, and the engine's computed 720-azimuth LOLA skyline is drawn as an overlay (authoritative: Cesium's rendered
// terrain far away is coarser than the computed horizon).
import {
  ArcType, BillboardCollection, Cartesian3, Cartographic, Color, CustomDataSource, Ellipsoid, HorizontalOrigin, LabelStyle,
  PointPrimitiveCollection, VerticalOrigin, type Billboard, type Viewer,
} from 'cesium';
import { getEngine } from '../engine/client.ts';
import { useStore } from '../store.ts';
import { setFirstPersonActive } from './cameraMode.ts';

const MOON = Ellipsoid.MOON;
const D2R = Math.PI / 180;
const SKY_DIST = 1.0e6; // m: Sun/Earth/stars are placed this far from the eye (real terrain still occludes them)
const SKYLINE_DIST = 4.0e5; // m
const PITCH_MIN = -60, PITCH_MAX = 85, FOV_MIN = 15, FOV_MAX = 100, FOV_DEFAULT = 70;
const SKYLINE_COLOR = '#2EE6C5';

export interface FirstPersonOpts { lat: number; lon: number; groundM: number; heightM?: number; headingDeg?: number; siteId?: string | null; pitchDeg?: number }
export interface SkyState { sunDir: ArrayLike<number>; earthDir: ArrayLike<number>; sunRadiusDeg: number; earthRadiusDeg: number; horizonDeg?: Float32Array }
export interface FirstPersonView { active: boolean; headingDeg: number; pitchDeg: number; fovDeg: number; skyline: boolean }

// orbit controls are written by another engineer in parallel; resolve them lazily so this compiles either way
const orbitMods = import.meta.glob('./orbitControls.ts', { eager: true }) as Record<string, { getOrbitControls?: () => { setEnabled(on: boolean): void } | null | undefined }>;
function setOrbitEnabled(on: boolean) {
  for (const m of Object.values(orbitMods)) { try { m.getOrbitControls?.()?.setEnabled(on); } catch { /* ignore */ } }
}

interface Saved {
  pos: Cartesian3; dir: Cartesian3; up: Cartesian3; near: number; far: number; fov: number;
  sse: number; vex: number; inputs: boolean; sky: boolean | undefined; ds: Record<string, boolean>;
}
interface State {
  viewer: Viewer; saved: Saved; lat: number; lon: number; groundM: number; heightM: number; eyeH: number; eye: Cartesian3;
  E: Cartesian3; N: Cartesian3; U: Cartesian3;
  heading: number; pitch: number; fov: number;
  tHeading: number; tPitch: number; anim: number | null; animT: number;
  sunDir: Cartesian3 | null; earthDir: Cartesian3 | null; sunR: number; earthR: number;
  bills: BillboardCollection; sun: Billboard; halo: Billboard; earth: Billboard; stars: PointPrimitiveCollection;
  skyDs: CustomDataSource; skylineOn: boolean; horizon: Float32Array | null; siteId: string | null;
  disposers: Array<() => void>; siteLabelAz: number; earthPhaseStep: number; busy: boolean; dirty: boolean;
}
let st: State | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** The viewer the first-person camera is active in (null when inactive). */
export function getFirstPersonViewer(): Viewer | null { return st?.viewer ?? null; }
export function isFirstPersonLive(): boolean { return !!st; }
export function getFirstPersonView(): FirstPersonView {
  return st ? { active: true, headingDeg: st.heading, pitchDeg: st.pitch, fovDeg: st.fov, skyline: st.skylineOn } : { active: false, headingDeg: 0, pitchDeg: 0, fovDeg: FOV_DEFAULT, skyline: false };
}
/** Subscribe to heading / pitch / FOV / skyline changes (for the HUD). Returns an unsubscribe function. */
export function onFirstPersonView(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

const wrap360 = (a: number) => ((a % 360) + 360) % 360;
const wrap180 = (a: number) => ((a + 540) % 360) - 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function enu(lat: number, lon: number) {
  const φ = lat * D2R, λ = lon * D2R;
  return {
    E: new Cartesian3(-Math.sin(λ), Math.cos(λ), 0),
    N: new Cartesian3(-Math.sin(φ) * Math.cos(λ), -Math.sin(φ) * Math.sin(λ), Math.cos(φ)),
    U: new Cartesian3(Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)),
  };
}
/** Local azimuth (clockwise from north) / elevation to a unit vector in the Moon-fixed frame. */
function azElToVec(s: State, azDeg: number, elDeg: number): Cartesian3 {
  const az = azDeg * D2R, el = elDeg * D2R, c = Math.cos(el);
  const e = c * Math.sin(az), n = c * Math.cos(az), u = Math.sin(el);
  return new Cartesian3(s.E.x * e + s.N.x * n + s.U.x * u, s.E.y * e + s.N.y * n + s.U.y * u, s.E.z * e + s.N.z * n + s.U.z * u);
}

// ---- sprites ----------------------------------------------------------------------------------
const DISC = 0.2; // sun disc radius as a fraction of the sprite half-width
function sunCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,254,240,1)'); grd.addColorStop(DISC * 0.92, 'rgba(255,252,232,1)'); grd.addColorStop(DISC * 1.05, 'rgba(255,236,170,0.6)');
  grd.addColorStop(0.4, 'rgba(255,205,100,0.20)'); grd.addColorStop(0.7, 'rgba(255,180,60,0.05)'); grd.addColorStop(1, 'rgba(255,170,40,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  return c;
}
function haloCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,225,150,0.30)'); grd.addColorStop(0.25, 'rgba(255,200,110,0.12)'); grd.addColorStop(1, 'rgba(255,190,90,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  return c;
}
const EARTH_DISC = 0.78;
const earthCache = new Map<number, HTMLCanvasElement>();
/** Blue Earth disc with phase; the lit side points to +x of the sprite (the sprite is rotated toward the Sun on screen). k = lit fraction 0..1 in 24 steps. */
function earthCanvas(step: number): HTMLCanvasElement {
  const hit = earthCache.get(step); if (hit) return hit;
  const k = step / 24, R = 128 * EARTH_DISC;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.translate(128, 128);
  const halo = g.createRadialGradient(0, 0, R * 0.95, 0, 0, 128);
  halo.addColorStop(0, 'rgba(110,175,255,0.35)'); halo.addColorStop(1, 'rgba(110,175,255,0)');
  g.fillStyle = halo; g.beginPath(); g.arc(0, 0, 128, 0, 7); g.fill();
  g.fillStyle = '#081329'; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill(); // dark limb disc
  if (k > 0.01) {
    const xt = R * (1 - 2 * k); // terminator offset along the Sun axis (cosPsi)
    g.save();
    g.beginPath(); g.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false);
    const rx = Math.max(0.5, Math.abs(xt));
    if (xt < 0) g.ellipse(0, 0, rx, R, 0, Math.PI / 2, 1.5 * Math.PI, false); else g.ellipse(0, 0, rx, R, 0, Math.PI / 2, -Math.PI / 2, true);
    g.closePath(); g.clip();
    const body = g.createRadialGradient(-R * 0.25, -R * 0.25, R * 0.1, 0, 0, R);
    body.addColorStop(0, '#d8ecff'); body.addColorStop(0.45, '#5aa0f0'); body.addColorStop(1, '#1d4f9e');
    g.fillStyle = body; g.fillRect(-R, -R, 2 * R, 2 * R);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (const [cx, cy, rx2, ry2, rot] of [[-0.3, -0.2, 0.55, 0.12, 0.4], [0.2, 0.25, 0.5, 0.1, -0.3], [0.1, -0.45, 0.4, 0.09, 0.1], [-0.4, 0.4, 0.3, 0.08, 0.7]]) {
      g.beginPath(); g.ellipse(cx * R, cy * R, rx2 * R, ry2 * R, rot, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(90,150,90,0.3)'; g.beginPath(); g.ellipse(-0.1 * R, 0.05 * R, 0.25 * R, 0.18 * R, 0.5, 0, 7); g.fill();
    g.restore();
  }
  earthCache.set(step, c);
  return c;
}

function makeStars(): PointPrimitiveCollection {
  const pts = new PointPrimitiveCollection();
  let s = 424242;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  for (let i = 0; i < 700; i++) {
    const z = rnd() * 2 - 1, a = rnd() * 2 * Math.PI, r = Math.sqrt(1 - z * z), m = Math.pow(rnd(), 3);
    pts.add({
      position: new Cartesian3(r * Math.cos(a) * SKY_DIST * 0.98, r * Math.sin(a) * SKY_DIST * 0.98, z * SKY_DIST * 0.98), // re-anchored to the eye on enter
      pixelSize: 1 + 1.6 * m, color: Color.fromCssColorString('#ffffff').withAlpha(0.3 + 0.7 * m),
    });
  }
  return pts;
}

// ---- camera ------------------------------------------------------------------------------------
function applyCamera(s: State) {
  s.viewer.camera.setView({ destination: s.eye, orientation: { heading: s.heading * D2R, pitch: s.pitch * D2R, roll: 0 } });
  s.viewer.scene.requestRender();
  emit();
}
function setEye(s: State, eyeH: number) {
  s.eyeH = eyeH;
  s.eye = Cartesian3.fromDegrees(s.lon, s.lat, eyeH, MOON);
  placeSky(s);
}
function placeBody(s: State, b: Billboard, dir: Cartesian3, radiusDeg: number, dist: number, scale = 1) {
  b.position = new Cartesian3(s.eye.x + dir.x * dist, s.eye.y + dir.y * dist, s.eye.z + dir.z * dist);
  const w = 2 * dist * Math.tan(radiusDeg * D2R) * scale;
  b.width = w; b.height = w;
}
function placeSky(s: State) {
  if (s.sunDir) {
    s.sun.show = true; s.halo.show = true;
    placeBody(s, s.sun, s.sunDir, s.sunR, SKY_DIST, 1 / DISC); // sprite half-width = disc radius / DISC
    placeBody(s, s.halo, s.sunDir, 7, SKY_DIST * 0.999);
  }
  if (s.earthDir) { s.earth.show = true; placeBody(s, s.earth, s.earthDir, s.earthR, SKY_DIST, 1 / EARTH_DISC); }
  s.viewer.scene.requestRender();
}
/** Rotate the Earth sprite so its lit side faces the Sun on screen (called each frame). */
function orientEarth(s: State) {
  if (!s.earthDir || !s.sunDir) return;
  const cam = s.viewer.camera;
  const proj = (d: Cartesian3) => {
    const f = Cartesian3.dot(d, cam.directionWC);
    return f > 0.05 ? [Cartesian3.dot(d, cam.rightWC) / f, Cartesian3.dot(d, cam.upWC) / f] : null;
  };
  const e = proj(s.earthDir), u = proj(s.sunDir);
  if (e && u) s.earth.rotation = Math.atan2(u[1] - e[1], u[0] - e[0]);
}

function drawSkyline(s: State) {
  s.skyDs.entities.removeAll();
  if (!s.skylineOn || !s.horizon || !s.horizon.length) { s.viewer.scene.requestRender(); return; }
  const h = s.horizon, n = h.length, pos: Cartesian3[] = [];
  for (let i = 0; i <= n; i++) {
    const v = azElToVec(s, (i % n) * 360 / n, h[i % n]);
    pos.push(new Cartesian3(s.eye.x + v.x * SKYLINE_DIST, s.eye.y + v.y * SKYLINE_DIST, s.eye.z + v.z * SKYLINE_DIST));
  }
  const col = Color.fromCssColorString(SKYLINE_COLOR);
  s.skyDs.entities.add({ polyline: { positions: pos, width: 2, arcType: ArcType.NONE, material: col.withAlpha(0.9), depthFailMaterial: col.withAlpha(0.9) } });
  // labelled once, just above the skyline in the direction the visitor first looks
  const az = s.siteLabelAz, el = h[Math.round(wrap360(az) / 360 * n) % n] + 1.2, v = azElToVec(s, az, el);
  s.skyDs.entities.add({
    position: new Cartesian3(s.eye.x + v.x * SKYLINE_DIST, s.eye.y + v.y * SKYLINE_DIST, s.eye.z + v.z * SKYLINE_DIST),
    label: {
      text: 'computed skyline (LOLA)', font: '600 12px "Inter Variable", ui-sans-serif, system-ui, sans-serif', style: LabelStyle.FILL, fillColor: col,
      showBackground: true, backgroundColor: Color.fromCssColorString('rgba(10,13,19,0.8)'), verticalOrigin: VerticalOrigin.BOTTOM, horizontalOrigin: HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  s.viewer.scene.requestRender();
}

// ---- public API --------------------------------------------------------------------------------
export function enterFirstPerson(viewer: Viewer, opts: FirstPersonOpts): void {
  if (viewer.isDestroyed()) return;
  if (st && st.viewer === viewer) exitFirstPerson(viewer, true); // re-enter at another site: keep nothing from the old state except the saved camera below
  const scene = viewer.scene, cam = viewer.camera, frustum = cam.frustum as unknown as { near: number; far: number; fov: number };
  const prev = savedForReenter;
  savedForReenter = null;
  const saved: Saved = prev ?? {
    pos: Cartesian3.clone(cam.positionWC), dir: Cartesian3.clone(cam.directionWC), up: Cartesian3.clone(cam.upWC),
    near: frustum.near, far: frustum.far, fov: frustum.fov, sse: scene.globe.maximumScreenSpaceError, vex: scene.verticalExaggeration,
    inputs: scene.screenSpaceCameraController.enableInputs, sky: scene.skyBox?.show, ds: {},
  };
  const heightM = opts.heightM ?? 2;
  const { E, N, U } = enu(opts.lat, opts.lon);
  const bills = new BillboardCollection({ scene });
  const mk = (img: HTMLCanvasElement) => bills.add({ position: Cartesian3.ZERO, image: img, sizeInMeters: true, show: false, verticalOrigin: VerticalOrigin.CENTER, horizontalOrigin: HorizontalOrigin.CENTER });
  const halo = mk(haloCanvas()), sun = mk(sunCanvas()), earth = mk(earthCanvas(12));
  const stars = makeStars();
  const skyDs = new CustomDataSource('fp-skyline');
  const heading = wrap360(opts.headingDeg ?? 0);
  const s: State = {
    viewer, saved, lat: opts.lat, lon: opts.lon, groundM: opts.groundM, heightM, eyeH: 0, eye: new Cartesian3(), E, N, U,
    heading, pitch: clamp(opts.pitchDeg ?? 2, PITCH_MIN, PITCH_MAX), fov: FOV_DEFAULT, tHeading: heading, tPitch: 2, anim: null, animT: 0,
    sunDir: null, earthDir: null, sunR: 0.2666, earthR: 0.95, bills, sun, halo, earth, stars, skyDs, skylineOn: true, horizon: null, siteId: opts.siteId ?? null,
    disposers: [], siteLabelAz: heading, earthPhaseStep: 12, busy: false, dirty: false,
  };
  s.tPitch = s.pitch;
  st = s;
  scene.primitives.add(stars); scene.primitives.add(bills); viewer.dataSources.add(skyDs);
  // hide the globe-scale Sun/Earth sprites, pins and rings (they would draw at the eye); restore on exit
  for (const name of ['sky', 'sel', 'results', 'sites']) {
    const d = viewer.dataSources.getByName(name)[0];
    if (d) { saved.ds[name] = saved.ds[name] ?? d.show; d.show = false; }
  }
  if (scene.skyBox) scene.skyBox.show = false; // inertial star skybox does not match the Moon-fixed frame; we draw our own stars
  scene.screenSpaceCameraController.enableInputs = false;
  scene.verticalExaggeration = 1; // the computed skyline is true-scale
  scene.globe.maximumScreenSpaceError = 1.5;
  frustum.near = 0.5; frustum.fov = FOV_DEFAULT * D2R;
  setFirstPersonActive(true); setOrbitEnabled(false);
  useStore.setState({ fpActive: true });

  setEye(s, opts.groundM + heightM);
  // anchor the stars to the eye
  for (let i = 0; i < stars.length; i++) { const p = stars.get(i); p.position = Cartesian3.add(p.position, s.eye, new Cartesian3()); }
  applyCamera(s);

  // never let the rendered terrain (coarser LOD than the engine heights) swallow the camera: re-measure when tiles settle
  const refine = () => {
    if (st !== s || viewer.isDestroyed()) return;
    const gh = scene.globe.getHeight(Cartographic.fromDegrees(s.lon, s.lat));
    if (gh === undefined || !Number.isFinite(gh)) return;
    const want = Math.max(s.groundM, gh) + s.heightM;
    if (Math.abs(want - s.eyeH) > 0.05) { setEye(s, want); applyCamera(s); drawSkyline(s); }
  };
  s.disposers.push(scene.globe.tileLoadProgressEvent.addEventListener((n) => { if (n === 0) refine(); }));
  s.disposers.push(scene.preRender.addEventListener(() => { if (st === s) orientEarth(s); }));
  refine();

  // input: drag = look, wheel = FOV, two-finger pinch = FOV
  const canvas = scene.canvas;
  const pts = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const degPerPx = () => s.fov / Math.max(200, canvas.clientWidth);
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    cancelAnim(s);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    canvas.style.cursor = 'grabbing';
  };
  const onMove = (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size >= 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) setFov(viewer, s.fov * pinch / d);
      pinch = d;
      return;
    }
    const k = degPerPx();
    s.heading = wrap360(s.heading - dx * k);
    s.pitch = clamp(s.pitch + dy * k, PITCH_MIN, PITCH_MAX);
    s.tHeading = s.heading; s.tPitch = s.pitch;
    applyCamera(s);
  };
  const onUp = (e: PointerEvent) => { pts.delete(e.pointerId); pinch = 0; if (!pts.size) canvas.style.cursor = ''; };
  const onWheel = (e: WheelEvent) => { e.preventDefault(); setFov(viewer, s.fov * Math.exp(e.deltaY * 0.001)); };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  s.disposers.push(() => {
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('wheel', onWheel);
    canvas.style.cursor = '';
  });

  // follow the timeline cursor (Sun/Earth) and the horizon of the selected site
  const pull = async () => {
    if (st !== s) return;
    if (s.busy) { s.dirty = true; return; }
    s.busy = true;
    try {
      const se = await getEngine().sunEarthAt(s.lat, s.lon, useStore.getState().cursor);
      if (st === s) updateSky(viewer, { sunDir: se.sunVecMe, earthDir: se.earthVecMe, sunRadiusDeg: se.sunRadiusDeg ?? 0.2666, earthRadiusDeg: se.earthRadiusDeg ?? 0.95 });
    } catch (e) { console.warn('[fp3d]', e); }
    s.busy = false;
    if (s.dirty) { s.dirty = false; pull(); }
  };
  const syncHorizon = () => {
    const hz = s.siteId ? useStore.getState().data[s.siteId]?.horizon : undefined;
    if (hz && hz.elevDeg !== s.horizon) updateSky(viewer, { ...currentSky(s), horizonDeg: hz.elevDeg });
  };
  let lastCursor = useStore.getState().cursor, lastData = useStore.getState().data;
  const unsub = useStore.subscribe((x) => {
    if (x.cursor !== lastCursor) { lastCursor = x.cursor; void pull(); }
    if (x.data !== lastData) { lastData = x.data; syncHorizon(); }
  });
  s.disposers.push(unsub);
  void pull();
  syncHorizon();
  emit();
}

let savedForReenter: Saved | null = null;
function currentSky(s: State): SkyState {
  return { sunDir: s.sunDir ? [s.sunDir.x, s.sunDir.y, s.sunDir.z] : [1, 0, 0], earthDir: s.earthDir ? [s.earthDir.x, s.earthDir.y, s.earthDir.z] : [1, 0, 0], sunRadiusDeg: s.sunR, earthRadiusDeg: s.earthR };
}

export function exitFirstPerson(viewer: Viewer, keepSaved = false): void {
  const s = st;
  if (!s || s.viewer !== viewer) return;
  st = null;
  cancelAnim(s);
  s.disposers.forEach((d) => { try { d(); } catch { /* ignore */ } });
  if (keepSaved) savedForReenter = s.saved;
  if (!viewer.isDestroyed()) {
    const scene = viewer.scene, f = viewer.camera.frustum as unknown as { near: number; far: number; fov: number };
    scene.primitives.remove(s.stars); scene.primitives.remove(s.bills); viewer.dataSources.remove(s.skyDs, true);
    for (const [name, show] of Object.entries(s.saved.ds)) { const d = viewer.dataSources.getByName(name)[0]; if (d) d.show = show; }
    if (scene.skyBox && s.saved.sky !== undefined) scene.skyBox.show = s.saved.sky;
    scene.screenSpaceCameraController.enableInputs = s.saved.inputs;
    scene.verticalExaggeration = s.saved.vex;
    scene.globe.maximumScreenSpaceError = s.saved.sse;
    if (!keepSaved) {
      f.near = s.saved.near; f.far = s.saved.far; f.fov = s.saved.fov;
      viewer.camera.setView({ destination: s.saved.pos, orientation: { direction: s.saved.dir, up: s.saved.up } });
    }
    scene.requestRender();
  }
  if (!keepSaved) { setFirstPersonActive(false); setOrbitEnabled(true); useStore.setState({ fpActive: false }); }
  emit();
}

function cancelAnim(s: State) { if (s.anim !== null) { cancelAnimationFrame(s.anim); s.anim = null; } }

/** Smoothly turn to look at a local azimuth / elevation (degrees; azimuth clockwise from north). */
export function lookAt(viewer: Viewer, azDeg: number, elDeg: number): void {
  const s = st;
  if (!s || s.viewer !== viewer) return;
  s.tHeading = wrap360(azDeg); s.tPitch = clamp(elDeg, PITCH_MIN, PITCH_MAX);
  cancelAnim(s);
  s.animT = performance.now();
  const step = (now: number) => {
    if (st !== s) return;
    const dt = Math.min(0.1, (now - s.animT) / 1000); s.animT = now;
    const k = 1 - Math.exp(-dt / 0.14);
    const dh = wrap180(s.tHeading - s.heading), dp = s.tPitch - s.pitch;
    if (Math.abs(dh) < 0.03 && Math.abs(dp) < 0.03) { s.heading = s.tHeading; s.pitch = s.tPitch; s.anim = null; applyCamera(s); return; }
    s.heading = wrap360(s.heading + dh * k); s.pitch += dp * k;
    applyCamera(s);
    s.anim = requestAnimationFrame(step);
  };
  s.anim = requestAnimationFrame(step);
}

export function setFov(viewer: Viewer, deg: number): void {
  const s = st;
  if (!s || s.viewer !== viewer) return;
  s.fov = clamp(deg, FOV_MIN, FOV_MAX);
  (viewer.camera.frustum as unknown as { fov: number }).fov = s.fov * D2R;
  viewer.scene.requestRender();
  emit();
}

/** Show or hide the computed-skyline overlay. */
export function setSkyline(viewer: Viewer, on: boolean): void {
  const s = st;
  if (!s || s.viewer !== viewer) return;
  s.skylineOn = on; drawSkyline(s); emit();
}

/**
 * Place the Sun and Earth (unit vectors from the site in the Moon-fixed frame, i.e. the engine's sunVecMe / earthVecMe) and,
 * optionally, replace the skyline (engine horizon elevations, one per azimuth bin starting at north, clockwise).
 * Sprites are sized to the true angular radius (sizeInMeters at a fixed distance), so they scale correctly with FOV and
 * are depth-tested: terrain in front of them hides them.
 */
export function updateSky(viewer: Viewer, sky: SkyState): void {
  const s = st;
  if (!s || s.viewer !== viewer) return;
  s.sunDir = new Cartesian3(sky.sunDir[0], sky.sunDir[1], sky.sunDir[2]);
  s.earthDir = new Cartesian3(sky.earthDir[0], sky.earthDir[1], sky.earthDir[2]);
  s.sunR = sky.sunRadiusDeg; s.earthR = sky.earthRadiusDeg;
  const cosPsi = clamp(Cartesian3.dot(s.sunDir, s.earthDir), -1, 1);
  const step = Math.round(((1 - cosPsi) / 2) * 24);
  if (step !== s.earthPhaseStep) { s.earthPhaseStep = step; s.earth.image = earthCanvas(step) as unknown as string; }
  placeSky(s);
  if (sky.horizonDeg) { s.horizon = sky.horizonDeg; drawSkyline(s); }
}

/** Local azimuth / elevation (deg) of a Moon-fixed direction as seen from the site. */
export function dirToAzEl(viewer: Viewer, v: ArrayLike<number>): { az: number; el: number } | null {
  const s = st;
  if (!s || s.viewer !== viewer) return null;
  const e = v[0] * s.E.x + v[1] * s.E.y + v[2] * s.E.z, n = v[0] * s.N.x + v[1] * s.N.y + v[2] * s.N.z, u = v[0] * s.U.x + v[1] * s.U.y + v[2] * s.U.z;
  return { az: wrap360(Math.atan2(e, n) / D2R), el: Math.asin(clamp(u, -1, 1)) / D2R };
}

/**
 * Open/close from the app state: reads the selected site, its horizon, the observer height and the timeline cursor from the
 * store (ground height falls back to the engine's terrain heights when the horizon is not loaded yet). Globe.tsx calls this.
 */
let syncToken = 0;
export async function syncFirstPerson(viewer: Viewer, open: boolean): Promise<void> {
  const my = ++syncToken;
  const sx = useStore.getState();
  const t = sx.selected ? sx.targets[sx.selected] : undefined;
  if (!open || !t) { exitFirstPerson(viewer); return; }
  const d = sx.data[sx.selected!];
  let ground = d?.horizon?.siteElevM;
  if (ground === undefined || !Number.isFinite(ground)) {
    ground = 0;
    try {
      const k = 0.0002, hs = await getEngine().sampleHeights(t.lon - k, t.lat - k, t.lon + k, t.lat + k, 3, 3);
      if (Number.isFinite(hs[4])) ground = hs[4];
    } catch { /* flat */ }
  }
  if (my !== syncToken || viewer.isDestroyed()) return;
  // first look direction: the Sun (or Earth when the Sun is down)
  let heading = 0, pitch = 2;
  try {
    const se = await getEngine().sunEarthAt(t.lat, t.lon, sx.cursor);
    if (se.sunEl > -3) { heading = se.sunAz; pitch = Math.max(2, se.sunEl); } else { heading = se.earthAz; pitch = Math.max(2, se.earthEl); }
  } catch { /* north */ }
  if (my !== syncToken || viewer.isDestroyed()) return;
  enterFirstPerson(viewer, { lat: t.lat, lon: t.lon, groundM: ground, heightM: useStore.getState().query.height_m ?? 2, headingDeg: heading, pitchDeg: pitch, siteId: sx.selected });
}
