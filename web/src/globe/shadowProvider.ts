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
    // bounding rectangle of the patch (whole longitude range if it contains a pole)
    const dLat = (this.halfM * Math.SQRT2) / R;
    const s = Math.max(-Math.PI / 2, lat - dLat), n = Math.min(Math.PI / 2, lat + dLat);
    if (s <= -Math.PI / 2 + 1e-6 || n >= Math.PI / 2 - 1e-6 || Math.abs(Math.abs(lat) + dLat) >= Math.PI / 2) this.rectangle = new Rectangle(-Math.PI, s, Math.PI, n);
    else {
      const dLon = Math.min(Math.PI, dLat / Math.max(0.05, Math.cos(Math.abs(lat) + dLat)));
      this.rectangle = new Rectangle(lon - dLon, s, lon + dLon, n);
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
        const fj = (gx + halfM) / pixelM - 0.5, fi = (halfM - gy) / pixelM - 0.5;
        const j0 = Math.max(0, Math.min(px - 2, Math.floor(fj))), i0 = Math.max(0, Math.min(px - 2, Math.floor(fi)));
        const a = Math.max(0, Math.min(1, fj - j0)), b = Math.max(0, Math.min(1, fi - i0));
        const at = (ii: number, jj: number, ch: number) => d[2 * (ii * px + jj) + ch];
        const bl = (ch: number) => (at(i0, j0, ch) * (1 - a) + at(i0, j0 + 1, ch) * a) * (1 - b) + (at(i0 + 1, j0, ch) * (1 - a) + at(i0 + 1, j0 + 1, ch) * a) * b;
        const sun = bl(0) / 255, shade = bl(1) / 255;
        const lit = sun * shade;
        const grey = 0.62 * lit;
        const o = 4 * (j * TS + i);
        // sunlit: warm grey; shadow: faint blue earthshine floor
        img.data[o] = Math.min(255, (0.035 + grey * 1.0) * 255 + 4);
        img.data[o + 1] = Math.min(255, (0.045 + grey * 0.98) * 255 + 6);
        img.data[o + 2] = Math.min(255, (0.085 + grey * 0.93) * 255 + 10);
        img.data[o + 3] = 235 * Math.max(0, Math.min(1, (1 - dd) / 0.12));
        any = true;
      }
    }
    if (!any) return Promise.resolve(this.blankTile());
    g.putImageData(img, 0, 0);
    return Promise.resolve(c);
  }

  pickFeatures() { return undefined; }
}
