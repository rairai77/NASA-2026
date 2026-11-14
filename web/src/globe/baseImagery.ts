// Higher-resolution Moon base imagery layered over the local SVS colour map:
//  - LROC WAC global mosaic (~100 m/px) as a plain Trek tile layer, active when zoomed in.
//  - LRO NAC polar average mosaics (1 m/px, polar stereographic) reprojected on the fly to geographic tiles.
// All sources are NASA/GSFC/Arizona State University, served by NASA Moon Trek (CORS-enabled, no CORP header,
// so every load here is in CORS mode to stay compatible with COEP require-corp).
import {
  Credit, Ellipsoid, Event as CEvent, GeographicTilingScheme, ImageryLayer, Rectangle, UrlTemplateImageryProvider,
} from 'cesium';
import type { Viewer } from 'cesium';
import { perfLog } from '../engine/perf.ts';

const R = 1737400;
const TS = 256;
const MOON = Ellipsoid.MOON;
const TREK = 'https://trek.nasa.gov/tiles/Moon';
const CREDIT_TEXT = 'LRO NAC/WAC mosaics: NASA/GSFC/Arizona State University, via NASA Moon Trek';

// NAC polar mosaic tile grid (identical for both poles).
const ORIGIN = 1095930; // m, top-left corner at (-ORIGIN, +ORIGIN)
const EXTENT = 2 * ORIGIN;
const MAX_SRC_LEVEL = 11;
const DATA_RADIUS = 136500; // m, data circle around the pole
const FEATHER_IN = 126000, FEATHER_OUT = 136000; // m, alpha 1 -> 0
const M_PER_DEG = (2 * Math.PI * R) / 360;
const MAX_SRC_TILES = 16;
const CONCURRENCY = 6;
const CACHE_BYTES = 25 * 1024 * 1024;

const pixAt = (L: number) => EXTENT / (TS * 2 ** L);

type Pole = 'S' | 'N';
interface SrcTile { data: Uint8Array | null } // 2 bytes/px: grey, alpha; null = missing/failed

const cache = new Map<string, SrcTile>(); // insertion order = LRU order
const pending = new Map<string, Promise<SrcTile>>();
let cacheBytes = 0;
let active = 0;
const queue: Array<() => void> = []; // run newest first: stale (zoomed-past) requests sink to the bottom

function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active++;
      job().then(resolve, reject).finally(() => { active--; const next = queue.pop(); if (next) next(); });
    };
    if (active < CONCURRENCY) run(); else queue.push(run);
  });
}

let scratch: OffscreenCanvas | HTMLCanvasElement | null = null;
async function decode(blob: Blob): Promise<Uint8Array> {
  const bmp = await createImageBitmap(blob);
  const w = bmp.width, h = bmp.height;
  if (!scratch) scratch = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(TS, TS) : Object.assign(document.createElement('canvas'), { width: TS, height: TS });
  scratch.width = TS; scratch.height = TS;
  const g = scratch.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.clearRect(0, 0, TS, TS);
  g.drawImage(bmp, 0, 0, w, h, 0, 0, TS, TS);
  bmp.close();
  const rgba = g.getImageData(0, 0, TS, TS).data;
  const out = new Uint8Array(TS * TS * 2);
  for (let i = 0, k = 0; i < rgba.length; i += 4, k += 2) { out[k] = rgba[i]; out[k + 1] = rgba[i + 3]; }
  return out;
}

function remember(key: string, t: SrcTile) {
  cache.set(key, t);
  cacheBytes += t.data ? t.data.byteLength : 64;
  for (const [k, v] of cache) {
    if (cacheBytes <= CACHE_BYTES || cache.size <= 1) break;
    cache.delete(k); cacheBytes -= v.data ? v.data.byteLength : 64;
  }
}

function getSrcTile(pole: Pole, L: number, row: number, col: number): Promise<SrcTile> {
  const key = `${pole}/${L}/${row}/${col}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return Promise.resolve(hit); } // refresh LRU position
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const dir = pole === 'S' ? 'SP/LRO_NAC_AvgMosaic_SPole855_1mp' : 'NP/LRO_NAC_AvgMosaic_NPole855_1mp';
  const url = `${TREK}/${dir}/1.0.0/default/default028mm/${L}/${row}/${col}.png`;
  const p = schedule(async (): Promise<SrcTile> => {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return { data: null };
      return { data: await decode(await res.blob()) };
    } catch { return { data: null }; }
  }).then((t) => { remember(key, t); pending.delete(key); return t; });
  pending.set(key, p);
  return p;
}

// Does the square of tile (L,row,col) intersect the data circle?
function tileHasData(L: number, row: number, col: number): boolean {
  const size = EXTENT / 2 ** L;
  const x0 = -ORIGIN + col * size, x1 = x0 + size, y1 = ORIGIN - row * size, y0 = y1 - size;
  const dx = x0 > 0 ? x0 : x1 < 0 ? -x1 : 0, dy = y0 > 0 ? y0 : y1 < 0 ? -y1 : 0;
  return dx * dx + dy * dy <= DATA_RADIUS * DATA_RADIUS;
}

const D2R = Math.PI / 180;

export class PolarMosaicImageryProvider {
  tilingScheme = new GeographicTilingScheme({ ellipsoid: MOON });
  rectangle: Rectangle;
  tileWidth = TS;
  tileHeight = TS;
  minimumLevel = 0;
  maximumLevel = 13;
  tileDiscardPolicy = undefined;
  errorEvent = new CEvent();
  credit = new Credit(CREDIT_TEXT);
  proxy = undefined;
  hasAlphaChannel = true;
  ready = true;
  readyEvent = new CEvent();
  private blank?: HTMLCanvasElement;
  private sgn: number; // +1 north, -1 south

  constructor(private pole: Pole) {
    this.sgn = pole === 'S' ? -1 : 1;
    const edge = 85.5 * D2R;
    this.rectangle = pole === 'S' ? new Rectangle(-Math.PI, -Math.PI / 2, Math.PI, -edge) : new Rectangle(-Math.PI, edge, Math.PI, Math.PI / 2);
  }

  private blankTile() {
    if (!this.blank) { this.blank = document.createElement('canvas'); this.blank.width = this.blank.height = 1; }
    return this.blank;
  }

  // Projected (x, y) in metres for latitude/longitude in radians.
  private project(lat: number, lon: number, out: number[]) {
    const c = this.pole === 'S' ? Math.PI / 2 + lat : Math.PI / 2 - lat;
    const rho = 2 * R * Math.tan(c / 2);
    out[0] = rho * Math.sin(lon);
    out[1] = (this.pole === 'S' ? 1 : -1) * rho * Math.cos(lon);
  }

  // Source tiles (L, row/col box) needed for an output tile; walks coarser until <= MAX_SRC_TILES.
  private plan(west: number, south: number, east: number, north: number, L0: number) {
    const touchesPole = this.pole === 'S' ? south <= -Math.PI / 2 + 1e-9 : north >= Math.PI / 2 - 1e-9;
    const pt = [0, 0];
    const xs: number[] = [], ys: number[] = [];
    const N = 24;
    for (let k = 0; k <= N; k++) {
      const u = k / N, lon = west + u * (east - west), lat = south + u * (north - south);
      for (const la of [south, north]) { this.project(la, lon, pt); xs.push(pt[0]); ys.push(pt[1]); }
      for (const lo of [west, east]) { this.project(lat, lo, pt); xs.push(pt[0]); ys.push(pt[1]); }
    }
    for (let L = L0; L >= 0; L--) {
      const n = 2 ** L, size = EXTENT / n;
      let c0 = n, c1 = -1, r0 = n, r1 = -1;
      for (let i = 0; i < xs.length; i++) {
        const c = Math.floor((xs[i] + ORIGIN) / size), r = Math.floor((ORIGIN - ys[i]) / size);
        c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
      }
      if (touchesPole && L > 0) { const m = n / 2; c0 = Math.min(c0, m - 1); c1 = Math.max(c1, m); r0 = Math.min(r0, m - 1); r1 = Math.max(r1, m); }
      c0 = Math.max(0, c0); r0 = Math.max(0, r0); c1 = Math.min(n - 1, c1); r1 = Math.min(n - 1, r1);
      const list: Array<[number, number]> = [];
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (tileHasData(L, r, c)) list.push([r, c]);
      if (list.length <= MAX_SRC_TILES || L === 0) return { L, c0, c1, r0, r1, list };
    }
    return null;
  }

  requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement> {
    return this.render(x, y, level).catch(() => this.blankTile());
  }

  private async render(x: number, y: number, level: number): Promise<HTMLCanvasElement> {
    const t0 = performance.now();
    const rect = this.tilingScheme.tileXYToRectangle(x, y, level);
    if (!Rectangle.intersection(rect, this.rectangle)) return this.blankTile();
    const { west, south, east, north } = rect;
    const spacing = ((north - south) / D2R / TS) * M_PER_DEG; // metres per output pixel along latitude
    const L0 = Math.max(0, Math.min(MAX_SRC_LEVEL, Math.ceil(Math.log2(pixAt(0) / spacing))));
    const pl = this.plan(west, south, east, north, L0);
    if (!pl || pl.list.length === 0) return this.blankTile();
    const { L, c0, r0, c1, list } = pl;
    const nc = c1 - c0 + 1;
    const grid: Array<SrcTile | undefined> = new Array(nc * (pl.r1 - r0 + 1));
    await Promise.all(list.map(async ([r, c]) => { grid[(r - r0) * nc + (c - c0)] = await getSrcTile(this.pole, L, r, c); }));
    if (!grid.some((t) => t && t.data)) return this.blankTile();

    const t1 = performance.now();
    const pix = pixAt(L), nr = pl.r1 - r0 + 1;
    const maxPx = nc * TS, maxPy = nr * TS;
    const offX = c0 * TS, offY = r0 * TS;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TS;
    const g = canvas.getContext('2d')!;
    const img = g.createImageData(TS, TS);
    const out = img.data;
    const sinLon = new Float64Array(TS), cosLon = new Float64Array(TS);
    for (let i = 0; i < TS; i++) { const lon = west + ((i + 0.5) / TS) * (east - west); sinLon[i] = Math.sin(lon); cosLon[i] = Math.cos(lon); }
    const ySign = this.pole === 'S' ? 1 : -1;
    const rho2max = DATA_RADIUS * DATA_RADIUS;
    let any = false;
    const sample = (ix: number, iy: number, o: Float64Array) => { // global source pixel -> [grey*alpha, alpha] (0 if missing)
      const lx = ix - offX, ly = iy - offY;
      if (lx < 0 || ly < 0 || lx >= maxPx || ly >= maxPy) { o[0] = 0; o[1] = 0; return; }
      const t = grid[(ly >> 8) * nc + (lx >> 8)];
      if (!t || !t.data) { o[0] = 0; o[1] = 0; return; }
      const k = 2 * ((ly & 255) * TS + (lx & 255));
      const a = t.data[k + 1];
      o[0] = t.data[k] * a; o[1] = a;
    };
    const s00 = new Float64Array(2), s10 = new Float64Array(2), s01 = new Float64Array(2), s11 = new Float64Array(2);
    for (let j = 0; j < TS; j++) {
      const lat = north - ((j + 0.5) / TS) * (north - south);
      const c = this.pole === 'S' ? Math.PI / 2 + lat : Math.PI / 2 - lat;
      const rho = 2 * R * Math.tan(c / 2);
      if (rho * rho > rho2max) continue;
      const fa = rho <= FEATHER_IN ? 1 : rho >= FEATHER_OUT ? 0 : (FEATHER_OUT - rho) / (FEATHER_OUT - FEATHER_IN);
      if (fa <= 0) continue;
      for (let i = 0; i < TS; i++) {
        const px = (rho * sinLon[i] + ORIGIN) / pix - 0.5, py = (ORIGIN - ySign * rho * cosLon[i]) / pix - 0.5;
        const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
        sample(ix, iy, s00); sample(ix + 1, iy, s10); sample(ix, iy + 1, s01); sample(ix + 1, iy + 1, s11);
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const a = s00[1] * w00 + s10[1] * w10 + s01[1] * w01 + s11[1] * w11;
        if (a < 1) continue;
        const grey = (s00[0] * w00 + s10[0] * w10 + s01[0] * w01 + s11[0] * w11) / a;
        const o = 4 * (j * TS + i);
        out[o] = out[o + 1] = out[o + 2] = grey;
        out[o + 3] = (a / 255) * fa * 255;
        any = true;
      }
    }
    if (!any) return this.blankTile();
    g.putImageData(img, 0, 0);
    perfLog('main.nacTile', performance.now() - t1, { level, srcLevel: L, srcTiles: list.length, fetchMs: Math.round(t1 - t0) });
    return canvas;
  }

  pickFeatures() { return undefined; }
}

export function addDetailImagery(viewer: Viewer): void {
  try {
    const layers = viewer.imageryLayers;
    const put = (layer: ImageryLayer, index: number) => layers.add(layer, Math.min(index, layers.length));
    const wacProvider = new UrlTemplateImageryProvider({
      url: `${TREK}/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`,
      tilingScheme: new GeographicTilingScheme({ ellipsoid: MOON }),
      ellipsoid: MOON, maximumLevel: 8, tileWidth: TS, tileHeight: TS,
      credit: new Credit(CREDIT_TEXT),
    });
    const wac = new ImageryLayer(wacProvider, { minimumTerrainLevel: 5 });
    wac.brightness = WAC_ADJUST.brightness; wac.contrast = WAC_ADJUST.contrast; wac.gamma = WAC_ADJUST.gamma;
    put(wac, 1);
    const south = new ImageryLayer(new PolarMosaicImageryProvider('S') as never);
    south.brightness = NAC_ADJUST.brightness; south.contrast = NAC_ADJUST.contrast; south.gamma = NAC_ADJUST.gamma;
    put(south, 2);
    if (SHIP_NORTH) {
      const north = new ImageryLayer(new PolarMosaicImageryProvider('N') as never);
      north.brightness = NAC_ADJUST.brightness; north.contrast = NAC_ADJUST.contrast; north.gamma = NAC_ADJUST.gamma;
      put(north, 3);
    }
    viewer.scene.requestRender();
  } catch { /* detail imagery is optional; never break the base layer */ }
}

const WAC_ADJUST = { brightness: 1, contrast: 1, gamma: 1 };
const NAC_ADJUST = { brightness: 1, contrast: 1, gamma: 1 };
const SHIP_NORTH = true;
