import LZ from 'lz-string';

export interface TargetStub { id: string; lat: number; lon: number; name: string; kind: string }
export interface ShareState {
  /** the full Query object: includes region (polar/circle/bbox/global/sites), relay and power; sanitised by mergeQuery on load */
  q?: unknown;
  sel?: TargetStub | null;
  cmp?: TargetStub[];
  t?: number;
  cam?: { p: number[]; d: number[]; u: number[] } | null;
  ed?: boolean;
  tab?: string;
}

export function encodeState(s: ShareState): string {
  return LZ.compressToEncodedURIComponent(JSON.stringify(s));
}
export function decodeState(hash: string): ShareState | null {
  try {
    const h = hash.replace(/^#s=/, '').replace(/^#/, '');
    if (!h) return null;
    const j = LZ.decompressFromEncodedURIComponent(h);
    return j ? (JSON.parse(j) as ShareState) : null;
  } catch { return null; }
}
