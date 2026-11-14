import * as Comlink from 'comlink';
import type { EngineApi, Progress, Query, RankResult } from './api.ts';

let remote: Comlink.Remote<EngineApi> | null = null;

export function getEngine(): Comlink.Remote<EngineApi> {
  if (!remote) {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    remote = Comlink.wrap<EngineApi>(w);
  }
  return remote;
}

export function rankWithProgress(q: Query, cb: (p: Progress) => void): Promise<RankResult> {
  return getEngine().rank(q, Comlink.proxy(cb));
}
