// Imagery provider that renders terrain-true shadows from an engine ShadowPatch (gnomonic ENU grid).
import { Cartesian3, Ellipsoid, Event as CEvent, GeographicTilingScheme, Math as CMath, Rectangle } from 'cesium';
import type { ShadowPatch } from '../engine/api.ts';

const R = 1737400;
const TS = 256;

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
  private halfM: number; private pixelM: number;
  private blank?: HTMLCanvasElement;

  constructor(private patch: ShadowPatch) {
    const lat = CMath.toRadians(patch.lat), lon = CMath.toRadians(patch.lon);
    this.U = new Cartesian3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
    this.E = new Cartesian3(-Math.sin(lon), Math.cos(lon), 0);
    this.N = new Cartesian3(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat));
    this.halfM = (patch.sizeKm * 1000) / 2;
    this.pixelM = (patch.sizeKm * 1000) / patch.px;
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

  private blankTile() {
    if (!this.blank) { this.blank = document.createElement('canvas'); this.blank.width = this.blank.height = 1; }
    return this.blank;
  }

  requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement> {
    const r = this.tilingScheme.tileXYToRectangle(x, y, level);
    if (!Rectangle.intersection(r, this.rectangle)) return Promise.resolve(this.blankTile());
    const c = document.createElement('canvas');
    c.width = c.height = TS;
    const g = c.getContext('2d')!;
    const img = g.createImageData(TS, TS);
    const px = this.patch.px, d = this.patch.data;
    const { U, E, N, halfM, pixelM } = this;
    const flat = Math.max(Math.sin(CMath.toRadians(Math.max(this.patch.sunEl ?? 2, 0.3))), 0.005);
    let any = false;
    for (let j = 0; j < TS; j++) {
      const lat = r.north - ((j + 0.5) / TS) * (r.north - r.south);
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let i = 0; i < TS; i++) {
        const lon = r.west + ((i + 0.5) / TS) * (r.east - r.west);
        const qx = cl * Math.cos(lon), qy = cl * Math.sin(lon), qz = sl;
        const qu = qx * U.x + qy * U.y + qz * U.z;
        if (qu <= 0.01) continue;
        const gx = (R * (qx * E.x + qy * E.y + qz * E.z)) / qu, gy = (R * (qx * N.x + qy * N.y + qz * N.z)) / qu;
        const dd = Math.max(Math.abs(gx), Math.abs(gy)) / halfM;
        if (dd >= 1) continue;
        const rr = Math.hypot(gx, gy) / halfM; // round patch with a soft edge
        if (rr >= 1) continue;
        const fj = (gx + halfM) / pixelM - 0.5, fi = (halfM - gy) / pixelM - 0.5;
        const j0 = Math.max(0, Math.min(px - 2, Math.floor(fj))), i0 = Math.max(0, Math.min(px - 2, Math.floor(fi)));
        const a = Math.max(0, Math.min(1, fj - j0)), b = Math.max(0, Math.min(1, fi - i0));
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
        const o = 4 * (j * TS + i);
        img.data[o] = 6; img.data[o + 1] = 9; img.data[o + 2] = 20; // earthshine-tinted black
        const edge = Math.max(0, Math.min(1, (1 - rr) / 0.15));
        img.data[o + 3] = 255 * 0.93 * (1 - lightness) * edge;
        any = true;
      }
    }
    if (!any) return Promise.resolve(this.blankTile());
    g.putImageData(img, 0, 0);
    return Promise.resolve(c);
  }

  pickFeatures() { return undefined; }
}
