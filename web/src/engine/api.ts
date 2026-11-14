// Types and the EngineApi interface (docs/CONTRACTS.md sections 4-8).
// The UI only talks to the compute engine through this interface (Comlink worker).

export type SiteGroup =
  | 'Apollo' | 'Luna' | "Chang'e" | 'Chandrayaan' | 'SLIM' | 'CLPS' | 'Artemis III regions' | 'Other';
export type SiteKind = 'landed' | 'planned' | 'candidate_region' | 'reference';

export interface Site {
  id: string;
  name: string;
  group: SiteGroup | string;
  lat: number;
  lon: number;
  kind: SiteKind | string;
  representative: boolean;
  note: string;
  source: string;
}

export interface Mission {
  id: string;
  name: string;
  lat: number;
  lon: number;
  landed_utc: string;
  end_utc: string;
  end_reason: string;
  reported_note: string;
  sources: string[];
}

export type MetricName =
  | 'sun_hours' | 'sun_frac' | 'longest_sun_h' | 'longest_dark_h'
  | 'earth_hours' | 'longest_earth_h' | 'longest_no_earth_h'
  | 'both_hours' | 'longest_both_h'
  | 'mean_sun_el_deg' | 'min_sun_el_deg' | 'sun_disc_frac_mean' | 'eclipse_hours'
  | 'comms_hours' | 'longest_comms_h' | 'marginal_hours'
  | 'energy_wh' | 'battery_wh_needed'
  | 'lat' | 'lon' | 'elev_m' | 'slope_deg' | 'psr_dist_km' | 'fault_dist_km';

export type Metrics = Partial<Record<MetricName, number>> & Record<string, number | undefined>;

export interface CuratedSite {
  horizon: number[]; // 720 values, degrees
  resolution_m: number;
  site_elev_m: number;
  monthly: ({ month: string } & Record<string, number | string>)[];
}

export interface HorizonResult {
  nAz: number;
  elevDeg: Float32Array;
  resolutionM: number;
  maxDistKm: number;
  siteElevM: number;
  missingSamples: number;
}

export type EventKind = 'sunrise' | 'sunset' | 'earthrise' | 'earthset' | 'eclipse_start' | 'eclipse_end';
export interface SkyEvent { t: number; kind: EventKind }

export interface VisResult {
  t: Float64Array;
  sunAz: Float32Array;
  sunEl: Float32Array;
  sunFrac: Float32Array;
  earthAz: Float32Array;
  earthEl: Float32Array;
  earthUp: Uint8Array;
  eclipseFrac: Float32Array;
  /** 0 no Earth line of sight, 1 marginal (Earth centre < 1.5 deg above the skyline), 2 clear */
  linkMargin?: Uint8Array;
  /** bit0 Goldstone, bit1 Canberra, bit2 Madrid (Moon >= 10 deg above that station's horizon); present when DSN is loaded or relay */
  dsnUp?: Uint8Array;
  metrics: Metrics;
  events: SkyEvent[];
}

export type Op = '<' | '<=' | '>' | '>=';
export type Dir = 'max' | 'min';

export type Region =
  | { type: 'polar'; min_lat: number; max_lat: number }
  | { type: 'circle'; lat: number; lon: number; radius_km: number }
  | { type: 'sites'; ids: string[] }
  | { type: 'bbox'; west: number; south: number; east: number; north: number }
  | { type: 'global' };

export type PanelKind = 'vertical_fixed' | 'vertical_tracking' | 'horizontal';
export interface Panel {
  kind: PanelKind;
  azimuthDeg?: number;
  areaM2: number;
  efficiency: number;
  loadW: number;
  depthOfDischarge: number;
  batteryWh?: number;
}
export interface PowerResult {
  t: Float64Array;
  powerW: Float32Array;
  energyWh: number;
  whPerDay: number;
  batteryWhNeeded: number;
  longestDarkH: number;
  survivesNight: boolean;
}
export interface TraverseLimits { maxSlopeDeg: number; speedMps: number; requireSun: boolean; requireEarth: boolean; maxHours: number }
export interface TraverseResult {
  path: { lat: number; lon: number; t: number }[];
  distanceM: number;
  durationS: number;
  sunlitFrac: number;
  earthFrac: number;
  status: 'ok' | 'no_path' | 'timeout';
  cellM: number;
  px: number;
}

export interface Filter { metric: string; op: Op; value: number }
export interface Objective { metric: string; dir: Dir }

export interface Query {
  window: { start: string; end: string };
  region: Region;
  height_m: number;
  filters: Filter[];
  objectives: Objective[];
  mode: 'lexicographic' | 'weighted';
  weights?: number[] | null;
  k: number;
  min_separation_km: number;
  /** assume continuous relay-orbiter coverage (comms metrics = window length) */
  relay?: boolean;
  /** power-model panel; enables energy_wh and battery_wh_needed */
  power?: Panel | null;
}

export interface RankEntry {
  rank: number;
  cell: number;
  lat: number;
  lon: number;
  metrics: Metrics;
  coarseMetrics?: Metrics;
  id?: string; // present for region.type == 'sites'
  /** true on the global (~10 km) screening grid */
  coarse?: boolean;
}

export interface RankResult {
  results: RankEntry[];
  considered: number;
  passedFilters: number;
  resolutionM: number;
  model: 'terrain' | 'mock' | string;
  /** true when ranked on the coarse global grid (~10 km cells) */
  coarse?: boolean;
  stats?: { global?: boolean } & Record<string, unknown>;
}

export interface EllipseArgs {
  lat: number;
  lon: number;
  semiMajorM: number;
  semiMinorM: number;
  rotDeg: number;
  n: number;
  heightM?: number;
  tStart: number;
  tEnd: number;
  stepS?: number;
}

export interface EllipseResult {
  points: { lat: number; lon: number; metrics: Metrics }[];
  summary: Record<string, { min: number; median: number; max: number }>;
}

export interface Progress { stage: string; done: number; total: number }

export interface SunEarth {
  sunAz: number; sunEl: number; earthAz: number; earthEl: number;
  sunRadiusDeg?: number; earthRadiusDeg?: number; eclipseFrac?: number;
  sunVecMe: [number, number, number];
  earthVecMe: [number, number, number];
}

/** Terrain-true shadow raster (CONTRACTS section 7): 2 bytes per pixel, [sunFrac*255, shading*255]. */
export interface ShadowPatch {
  lat: number; lon: number; sizeKm: number; px: number;
  data: Uint8Array;
  /** Sun azimuth/elevation (deg) at the patch centre */
  sunAz?: number; sunEl?: number;
  /** true when synthetic (wasm engine without shadowPatch) */
  mock?: boolean;
}

export interface InitInfo {
  threads: number;
  crossOriginIsolated: boolean;
  dataVersion: string;
  /** Deviation from CONTRACTS section 8: which backend is active. */
  mode: 'wasm' | 'mock';
  /** true when the DSN visibility table is loaded (real comms metrics) */
  dsn?: boolean;
  /** Human-readable notes (e.g. why we fell back to mock, partially missing data). */
  notes: string[];
}

export interface EngineApi {
  init(baseUrl: string): Promise<InitInfo>;
  sites(): Promise<Site[]>;
  missions(): Promise<Mission[]>;
  curated(): Promise<Record<string, CuratedSite>>;
  horizon(lat: number, lon: number, heightM?: number): Promise<HorizonResult>;
  visibility(
    lat: number, lon: number, tStart: number, tEnd: number,
    opts?: { heightM?: number; stepS?: number; elevDeg?: Float32Array; relay?: boolean },
  ): Promise<VisResult>;
  compare(
    points: { id: string; lat: number; lon: number }[], tStart: number, tEnd: number,
  ): Promise<Record<string, VisResult>>;
  rank(query: Query, onProgress?: (p: Progress) => void): Promise<RankResult>;
  ellipse(args: EllipseArgs): Promise<EllipseResult>;
  sampleHeights(west: number, south: number, east: number, north: number, w: number, h: number): Promise<Float32Array>;
  sunEarthAt(lat: number, lon: number, t: number): Promise<SunEarth>;
  faults(): Promise<GeoJSON.FeatureCollection>;
  /** Solar power / battery model (CONTRACTS section 7) for one site over a window. Null when the engine cannot run it (mock). */
  power(lat: number, lon: number, tStart: number, tEnd: number, panel: Panel, opts?: { heightM?: number; stepS?: number; elevDeg?: Float32Array }): Promise<PowerResult | null>;
  /** Rover traverse planner (CONTRACTS section 7). Null when unsupported (mock). */
  traverse(start: { lat: number; lon: number }, goal: { lat: number; lon: number }, tStart: number, limits: TraverseLimits, cellM?: number): Promise<TraverseResult | null>;
  /** Terrain-true shadows around (lat, lon). Mock patch when the wasm engine lacks shadowPatch. */
  shadowPatch(lat: number, lon: number, sizeKm: number, px: number, t: number): Promise<ShadowPatch>;
}

export const MOON_R_M = 1737400;
