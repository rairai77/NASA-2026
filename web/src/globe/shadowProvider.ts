// Imagery provider that renders terrain-true shadows from an engine ShadowPatch (gnomonic ENU grid).
//
// Tile reprojection is the hot loop (256x256 pixels per tile, main thread). It is kept cheap by precomputing
// everything that only depends on the tile column or row (no trig per pixel), writing packed RGBA words into a
// Uint32Array, rejecting tiles that lie outside the round patch with one angular test, and by a small scheduler
// that runs tile jobs newest-first under a per-task time budget so the UI never janks.
import { Cartesian3, Ellipsoid, Event as CEvent, GeographicTilingScheme, Math as CMath, Rectangle } from 'cesium';
import { perfLog } from '../engine/perf.ts';
import type { ShadowPatch } from '../engine/api.ts';

const R = 1737400;
const TS = 256;
/** Time budget per scheduler task (ms); between tasks the browser can paint and handle input. */
const BUDGET_MS = 5;

// ---- tile job scheduler: newest first, time-sliced -------------------------------------------------------
interface Job { run: () => void; dead: () => boolean }
const queue: Job[] = [];
let pumping = false;
let chan: MessageChannel | null = null;
function schedule() {
  if (pumping) return;
  pumping = true;
  if (!chan) { chan = new MessageChannel(); chan.port1.onmessage = step; }
  chan.port2.postMessage(0);
}
function step() {
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < BUDGET_MS) {
    const j = queue.pop()!; // LIFO: the camera usually cares about the most recently requested tiles
    if (!j.dead()) j.run();
  }
  if (queue.length) chan!.port2.postMessage(0);
  else pumping = false;
}

export class ShadowImageryProvider {
  tilingScheme = new GeographicTilingScheme({ ellipsoid: Ellipsoid.MOON });
  rectangle: Rectangle;
  tileWidth = TS;
  tileHeight = TS;
  minimumLevel = 0;
  maximumLevel = 16;
  tileDiscardPolicy = undefined;
  errorEvent = new CEvent();
  credit = undefined;
  proxy = undefined;
  hasAlphaChannel = true;
  ready = true;
  readyEvent = new CEvent();
  private U: Cartesian3; private E: Cartesian3; private N: Cartesian3;
  private halfM: number; private pixelM: number; private feather = 0.05; private maxAlpha = 0.92;
  private blank?: HTMLCanvasElement;
  private disposed = false;
  private patchAng: number; // angular radius of the round patch (rad)
  private flat: number;
  private stats = { tiles: 0, drawn: 0, ms: 0, max: 0 };
  private statTimer: ReturnType<typeof setTimeout> | undefined;
  // column tables are shared by every tile of the same (level, x) -> small cache
  private colCache = new Map<string, { au: Float64Array; ae: Float64Array; an: Float64Array }>();

  constructor(private patch: ShadowPatch) {
    const lat = CMath.toRadians(patch.lat), lon = CMath.toRadians(patch.lon);
    this.U = new Cartesian3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
    this.E = new Cartesian3(-Math.sin(lon), Math.cos(lon), 0);
    this.N = new Cartesian3(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat));
    this.halfM = (patch.sizeKm * 1000) / 2;
    this.pixelM = (patch.sizeKm * 1000) / patch.px;
    this.patchAng = Math.atan(this.halfM / R);
    this.flat = Math.max(Math.sin(CMath.toRadians(Math.max(patch.sunEl ?? 2, 0.3))), 0.005);
    // Regional patches fade out over a wider rim and let a little base texture through, so the patch edge
    // doesn't read as a dark disc against the (uniformly lit) base mosaic. Local patches stay crisp.
    this.feather = patch.sizeKm > 200 ? 0.14 : 0.05;
    this.maxAlpha = patch.sizeKm > 200 ? 0.86 : 0.92;
    // A level-L geographic tile pixel is ~R*pi/2^L/256 m; past the patch resolution Cesium upsamples.
    this.maximumLevel = Math.max(1, Math.min(16, Math.ceil(Math.log2((R * Math.PI) / TS / this.pixelM)) + 1));
    // Bounding rectangle of the (round) patch: sample its rim through the inverse gnomonic map.
    // Whole longitude range when the pole lies inside the patch.
    const poleDist = R * (Math.PI / 2 - Math.abs(lat)); // metres from the nearer pole
    let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
    for (let k = 0; k < 96; k++) {
      const th = (k / 96) * 2 * Math.PI;
      const gx = (this.halfM * Math.cos(th)) / R, gy = (this.halfM * Math.sin(th)) / R;
      const x = this.U.x + gx * this.E.x + gy * this.N.x, y = this.U.y + gx * this.E.y + gy * this.N.y, z = this.U.z + gx * this.E.z + gy * this.N.z;
      const r = Math.hypot(x, y, z);
      const la = Math.asin(z / r);
      let dl = Math.atan2(y, x) - lon;
      dl = Math.atan2(Math.sin(dl), Math.cos(dl));
      s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, dl); e = Math.max(e, dl);
    }
    const pad = 1e-4;
    if (poleDist <= this.halfM * 1.05) {
      this.rectangle = lat < 0 ? new Rectangle(-Math.PI, -Math.PI / 2, Math.PI, n + pad) : new Rectangle(-Math.PI, s - pad, Math.PI, Math.PI / 2);
    } else {
      const west = CMath.negativePiToPi(lon + w - pad), east = CMath.negativePiToPi(lon + e + pad);
      this.rectangle = new Rectangle(west, Math.max(-Math.PI / 2, s - pad), east, Math.min(Math.PI / 2, n + pad));
    }
  }

  /** Drop queued tile jobs and tables; call when the layer is removed. */
  dispose() { this.disposed = true; this.colCache.clear(); }

  private blankTile() {
    if (!this.blank) { this.blank = document.createElement('canvas'); this.blank.width = this.blank.height = 1; }
    return this.blank;
  }

  requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement> {
    const r = this.tilingScheme.tileXYToRectangle(x, y, level);
    if (this.disposed || !Rectangle.intersection(r, this.rectangle) || !this.tileMayTouchPatch(r)) return Promise.resolve(this.blankTile());
    return new Promise((resolve) => {
      queue.push({ dead: () => this.disposed, run: () => resolve(this.renderTile(x, level, r)) });
      schedule();
    });
  }

  /** Cheap conservative test: is the tile's bounding cap within reach of the round patch? */
  private tileMayTouchPatch(r: Rectangle): boolean {
    const lc = (r.north + r.south) / 2;
    let lonc = (r.west + r.east) / 2;
    if (r.east < r.west) lonc += Math.PI; // antimeridian (not produced by our scheme, kept for safety)
    const cl = Math.cos(lc);
    const qx = cl * Math.cos(lonc), qy = cl * Math.sin(lonc), qz = Math.sin(lc);
    const dot = qx * this.U.x + qy * this.U.y + qz * this.U.z;
    const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
    // half-diagonal of the tile as an angle: lat half-extent and lon half-extent scaled by the larger |cos(lat)|
    const hl = (r.north - r.south) / 2;
    const maxCos = Math.max(Math.cos(r.north), Math.cos(r.south));
    const hw = ((r.east - r.west) / 2) * maxCos;
    return ang - Math.hypot(hl, hw) * 1.05 < this.patchAng * 1.02;
  }

  private columns(level: number, x: number, r: Rectangle) {
    const key = `${level}/${x}`;
    let c = this.colCache.get(key);
    if (c) return c;
    const au = new Float64Array(TS), ae = new Float64Array(TS), an = new Float64Array(TS);
    const { U, E, N } = this;
    const dl = (r.east - r.west) / TS;
    for (let i = 0; i < TS; i++) {
      const lon = r.west + (i + 0.5) * dl;
      const co = Math.cos(lon), si = Math.sin(lon);
      au[i] = co * U.x + si * U.y;
      ae[i] = co * E.x + si * E.y;
      an[i] = co * N.x + si * N.y;
    }
    c = { au, ae, an };
    if (this.colCache.size > 64) this.colCache.clear();
    this.colCache.set(key, c);
    return c;
  }

  private renderTile(x: number, level: number, r: Rectangle): HTMLCanvasElement {
    const t0 = performance.now();
    const { au, ae, an } = this.columns(level, x, r);
    const px = this.patch.px, d = this.patch.data;
    const { U, E, N, halfM, pixelM, flat } = this;
    const Uz = U.z, Ez = E.z, Nz = N.z;
    const invHalf = 1 / halfM, invPix = 1 / pixelM;
    const feather = this.feather, maxAlpha = this.maxAlpha;
    const buf = new Uint32Array(TS * TS);
    const dLat = (r.north - r.south) / TS;
    const lastIdx = px - 2;
    let any = false;
    for (let j = 0; j < TS; j++) {
      const lat = r.north - (j + 0.5) * dLat;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      const slU = sl * Uz, slE = sl * Ez, slN = sl * Nz;
      const row = j * TS;
      for (let i = 0; i < TS; i++) {
        const qu = cl * au[i] + slU;
        if (qu <= 0.01) continue;
        const k = R / qu;
        const gx = k * (cl * ae[i] + slE), gy = k * (cl * an[i] + slN);
        const rr = Math.sqrt(gx * gx + gy * gy) * invHalf; // round patch with a soft edge
        if (rr >= 1) continue;
        const fj = (gx + halfM) * invPix - 0.5, fi = (halfM - gy) * invPix - 0.5;
        let j0 = Math.floor(fj), i0 = Math.floor(fi);
        j0 = j0 < 0 ? 0 : j0 > lastIdx ? lastIdx : j0;
        i0 = i0 < 0 ? 0 : i0 > lastIdx ? lastIdx : i0;
        let a = fj - j0, b = fi - i0;
        a = a < 0 ? 0 : a > 1 ? 1 : a;
        b = b < 0 ? 0 : b > 1 ? 1 : b;
        const k00 = 2 * (i0 * px + j0), k10 = k00 + 2 * px;
        const w00 = (1 - a) * (1 - b), w01 = a * (1 - b), w10 = (1 - a) * b, w11 = a * b;
        const sun = (d[k00] * w00 + d[k00 + 2] * w01 + d[k10] * w10 + d[k10 + 2] * w11) / 255;
        if (sun >= 0.999 && d[k00 + 1] >= 254 * flat) continue; // fully lit, flat-or-sunward: transparent
        const shade = (d[k00 + 1] * w00 + d[k00 + 3] * w01 + d[k10 + 1] * w10 + d[k10 + 3] * w11) / 255;
        // Shadow mask over the base imagery: transparent where fully lit, dark where shadowed.
        // Lambert shading is normalised by the flat-ground value so level lit ground keeps the
        // base brightness and only slopes facing away from the Sun darken.
        const rel = Math.min(1, shade / flat);
        const lightness = sun * (0.25 + 0.75 * rel);
        const edge = Math.max(0, Math.min(1, (1 - rr) / feather));
        const alpha = (255 * maxAlpha * (1 - lightness) * edge + 0.5) | 0; // rounds like the Uint8ClampedArray write it replaces
        // RGBA bytes 6, 9, 20 (earthshine-tinted black) + alpha, little-endian word
        buf[row + i] = ((alpha << 24) | (20 << 16) | (9 << 8) | 6) >>> 0;
        any = true;
      }
    }
    let out: HTMLCanvasElement;
    if (!any) out = this.blankTile();
    else {
      out = document.createElement('canvas');
      out.width = out.height = TS;
      const g = out.getContext('2d')!;
      g.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer), TS, TS), 0, 0);
    }
    this.record(performance.now() - t0, any);
    return out;
  }

  /** Dev: one summary line per patch (tiles, drawn, total and max ms), emitted once tile jobs go quiet. */
  private record(ms: number, drawn: boolean) {
    const st = this.stats;
    st.tiles++; if (drawn) st.drawn++; st.ms += ms; st.max = Math.max(st.max, ms);
    if (!import.meta.env.DEV) return;
    perfLog('main.reprojTile', ms, { any: drawn, px: this.patch.px });
    clearTimeout(this.statTimer);
    this.statTimer = setTimeout(() => { perfLog('main.reprojPatch', st.ms, { tiles: st.tiles, drawn: st.drawn, maxTileMs: Math.round(st.max * 10) / 10, sizeKm: this.patch.sizeKm, px: this.patch.px }); }, 400);
  }

  pickFeatures() { return undefined; }
}
