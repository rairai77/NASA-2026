// Dev-only performance log. console.debug('[perf] ...') plus a buffer on globalThis.__perf (main thread and workers)
// so a headless harness can read the numbers back. No-ops in production builds.
export const PERF = import.meta.env.DEV;

export interface PerfEntry { name: string; ms: number; t: number; extra?: Record<string, unknown> }

export function perfLog(name: string, ms: number, extra?: Record<string, unknown>): void {
  if (!PERF) return;
  const g = globalThis as unknown as { __perf?: PerfEntry[] };
  (g.__perf ??= []).push({ name, ms, t: performance.now(), extra });
  console.debug(`[perf] ${name} ${ms.toFixed(1)} ms`, extra ? JSON.stringify(extra) : '');
}

/** Time an async or sync call; returns its result. */
export function perfTime<T>(name: string, fn: () => T, extra?: () => Record<string, unknown>): T {
  if (!PERF) return fn();
  const t0 = performance.now();
  const r = fn();
  if (r instanceof Promise) return r.finally(() => perfLog(name, performance.now() - t0, extra?.())) as T;
  perfLog(name, performance.now() - t0, extra?.());
  return r;
}
