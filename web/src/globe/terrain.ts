import { CustomHeightmapTerrainProvider, Ellipsoid, GeographicTilingScheme, Math as CMath, type TerrainProvider } from 'cesium';
import { perfLog } from '../engine/perf.ts';
import type { EngineApi } from '../engine/api.ts';

/** Deepest level requested. LOLA 20 m near the pole ~ level 13 (tile 1.4 km / 64 cells ~ 22 m). */
export const TERRAIN_MAX_LEVEL = 13;

/**
 * Terrain from our LOLA stack: Cesium CustomHeightmapTerrainProvider whose callback asks the engine worker
 * (requiredTilesRect -> fetch tiles -> sampleHeights). Heights are metres above the 1737.4 km sphere.
 */
export function createTerrainProvider(engine: Pick<EngineApi, 'sampleHeights'>): TerrainProvider {
  const tilingScheme = new GeographicTilingScheme({ ellipsoid: Ellipsoid.MOON });
  const inflight = new Map<string, Promise<Float32Array>>();
  const provider = new CustomHeightmapTerrainProvider({
    tilingScheme,
    ellipsoid: Ellipsoid.MOON,
    width: 65,
    height: 65,
    callback: (x: number, y: number, level: number) => {
      const key = `${level}/${x}/${y}`;
      let p = inflight.get(key);
      if (!p) {
        const r = tilingScheme.tileXYToRectangle(x, y, level);
        const n = level < 4 ? 33 : 65;
        const t0 = performance.now();
        p = engine
          .sampleHeights(CMath.toDegrees(r.west), CMath.toDegrees(r.south), CMath.toDegrees(r.east), CMath.toDegrees(r.north), n, n)
          .then((h) => {
            const out = new Float32Array(65 * 65);
            if (n === 65) out.set(h.length === 65 * 65 ? h : new Float32Array(65 * 65));
            else {
              // bilinear upsample 33 -> 65
              for (let i = 0; i < 65; i++) for (let j = 0; j < 65; j++) {
                const fi = i / 2, fj = j / 2, i0 = Math.floor(fi), j0 = Math.floor(fj), i1 = Math.min(32, i0 + 1), j1 = Math.min(32, j0 + 1);
                const a = fi - i0, b = fj - j0;
                out[i * 65 + j] = (h[i0 * 33 + j0] * (1 - b) + h[i0 * 33 + j1] * b) * (1 - a) + (h[i1 * 33 + j0] * (1 - b) + h[i1 * 33 + j1] * b) * a;
              }
            }
            for (let k = 0; k < out.length; k++) if (!Number.isFinite(out[k])) out[k] = 0;
            return out;
          })
          .catch(() => new Float32Array(65 * 65))
          .then((o) => { perfLog('main.terrainTile', performance.now() - t0, { level, at: Math.round(performance.now()) }); return o; })
          .finally(() => setTimeout(() => inflight.delete(key), 3000));
        inflight.set(key, p);
      }
      return p;
    },
  });
  // Do not request tiles deeper than the data supports; Cesium upsamples from the parent instead.
  (provider as unknown as { getTileDataAvailable: (x: number, y: number, l: number) => boolean }).getTileDataAvailable = (_x, _y, l) => l <= TERRAIN_MAX_LEVEL;
  return provider;
}
