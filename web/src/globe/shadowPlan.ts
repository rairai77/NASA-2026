// Which terrain-true shadow patches to compute for the current view.
//
//   regional (camera above LOCAL_ALT_M): the 650 km patch at the south pole, as before
//   local: a patch centred on the point at the screen centre ("view" slot), sized from the camera range and
//          resolved from the DEM that exists there; plus, if the selected site is in view but outside the inner
//          half of that patch, a small patch around it ("site" slot)
//   first-person: a 40 km, ~20 m/px patch around the site (view following is off)
import { Cartesian2, Cartesian3, Ellipsoid, Math as CMath, type Viewer } from 'cesium';

const MOON = Ellipsoid.MOON;
const R = 1737400;
/** Camera height below which patches follow the view (same threshold as the "local" regime). */
export const LOCAL_ALT_M = 3.5e5;
/** Re-centre a patch once the view centre has moved this fraction of the patch radius. */
export const RECENTRE_FRAC = 0.3;

export interface ShadowPlan { slot: 'view' | 'site'; lat: number; lon: number; sizeKm: number; px: number }

export const POLE_PLAN: ShadowPlan = { slot: 'view', lat: -90, lon: 0, sizeKm: 650, px: 1024 };
/** Allowed patch sizes (km): discrete steps keep the cache effective and stop the size flapping while zooming. */
const SIZES_KM = [20, 40, 60, 100, 160, 250, 400];
const MAX_PX = 2048;

/** Pixel size (m) of the best DEM level that can exist at a latitude: s0 20 m inside 85S, s1 80 m to 80S, s2 240 m to 60S, g0 474 m elsewhere. */
export function demPixelM(lat: number): number {
  return lat < -85 ? 20 : lat < -80 ? 80 : lat < -60 ? 240 : 474;
}

/** Patch size for a camera-to-view-centre distance: about twice the range, so the camera foot is inside it
 *  (28 km range -> 60 km patch, the size used for a fly-to-site framing). */
export function sizeForRangeKm(rangeKm: number): number {
  const want = 2.1 * rangeKm;
  return SIZES_KM.find((s) => s >= want) ?? SIZES_KM[SIZES_KM.length - 1];
}

/** Pixels for a patch: ~25 m pixels on the 20 m DEM (accurate shadows), else 0.75x the DEM pixel (finer is wasted),
 *  multiple of 64, at most 2048 (the cost grows with px^2). */
export function pxFor(lat: number, sizeKm: number): number {
  const radiusDeg = CMath.toDegrees(((sizeKm * 500) / R));
  const bestLat = lat < 0 ? Math.max(-90, lat - radiusDeg) : lat; // the most polar edge sees the finest DEM
  const target = Math.max(25, demPixelM(bestLat) * 0.75);
  const px = Math.ceil((sizeKm * 1000) / target / 64) * 64;
  return Math.max(256, Math.min(MAX_PX, px));
}

const roundDeg = (v: number) => Math.round(v * 500) / 500; // 0.002 deg ~ 60 m: stable cache keys

function chordM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const la = CMath.toRadians(a.lat), lb = CMath.toRadians(b.lat), dl = CMath.toRadians(a.lon - b.lon);
  const c = Math.sin(la) * Math.sin(lb) + Math.cos(la) * Math.cos(lb) * Math.cos(dl);
  return R * Math.acos(Math.max(-1, Math.min(1, c)));
}

/** The point at the screen centre (terrain-aware, falling back to the ellipsoid, then to the camera nadir). */
function viewCentre(viewer: Viewer): { lat: number; lon: number; rangeM: number } {
  const { scene, camera: cam } = viewer;
  const c = new Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
  const ray = cam.getPickRay(c);
  let hit: Cartesian3 | undefined;
  try { hit = ray ? scene.globe.pick(ray, scene) : undefined; } catch { /* terrain not ready */ }
  hit ??= cam.pickEllipsoid(c, MOON) ?? undefined;
  if (hit) {
    const g = MOON.cartesianToCartographic(hit);
    if (g) return { lat: CMath.toDegrees(g.latitude), lon: CMath.toDegrees(g.longitude), rangeM: Cartesian3.distance(cam.positionWC, hit) };
  }
  const g = cam.positionCartographic;
  return { lat: CMath.toDegrees(g.latitude), lon: CMath.toDegrees(g.longitude), rangeM: Math.max(g.height, 1000) };
}

function inView(viewer: Viewer, site: { lat: number; lon: number }): boolean {
  const p = Cartesian3.fromDegrees(site.lon, site.lat, 0, MOON);
  if (Cartesian3.dot(p, viewer.camera.positionWC) <= R * R) return false; // beyond the horizon
  const w = viewer.scene.cartesianToCanvasCoordinates(p);
  const cv = viewer.scene.canvas;
  return !!w && w.x >= 0 && w.y >= 0 && w.x <= cv.clientWidth && w.y <= cv.clientHeight;
}

export function computePlans(viewer: Viewer, site: { lat: number; lon: number } | undefined, firstPerson: boolean): ShadowPlan[] {
  if (firstPerson && site) return [{ slot: 'view', lat: roundDeg(site.lat), lon: roundDeg(site.lon), sizeKm: 40, px: MAX_PX }];
  if (viewer.camera.positionCartographic.height >= LOCAL_ALT_M) return [POLE_PLAN];
  const vc = viewCentre(viewer);
  const sizeKm = sizeForRangeKm(vc.rangeM / 1000);
  const lat = roundDeg(vc.lat), lon = roundDeg(vc.lon);
  const plans: ShadowPlan[] = [{ slot: 'view', lat, lon, sizeKm, px: pxFor(lat, sizeKm) }];
  if (site && inView(viewer, site) && chordM(site, { lat, lon }) > sizeKm * 250) {
    const sKm = Math.min(60, sizeKm);
    plans.push({ slot: 'site', lat: roundDeg(site.lat), lon: roundDeg(site.lon), sizeKm: sKm, px: pxFor(site.lat, sKm) });
  }
  return plans;
}

/** True when `next` differs enough from `prev` to recompute: other slots/size/px, the view centre moved more than
 *  30% of the patch radius, or the site moved. */
export function needsReplan(prev: ShadowPlan[], next: ShadowPlan[]): boolean {
  if (prev.length !== next.length) return true;
  for (const n of next) {
    const o = prev.find((x) => x.slot === n.slot);
    if (!o || o.sizeKm !== n.sizeKm || o.px !== n.px) return true;
    const thr = n.slot === 'site' ? 100 : RECENTRE_FRAC * n.sizeKm * 500;
    if (chordM(o, n) > thr) return true;
  }
  return false;
}

export function formatRes(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
