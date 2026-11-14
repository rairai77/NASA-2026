import { EllipsoidTerrainProvider, Ellipsoid, type TerrainProvider } from 'cesium';
import type { EngineApi } from '../engine/api.ts';

/**
 * Phase 2 hook: will return a CustomHeightmapTerrainProvider whose callback calls
 * engine.sampleHeights(west, south, east, north, w, h) (LOLA tiles). For now: smooth ellipsoid.
 */
export function createTerrainProvider(_engine: Pick<EngineApi, 'sampleHeights'>): TerrainProvider {
  return new EllipsoidTerrainProvider({ ellipsoid: Ellipsoid.MOON });
}
