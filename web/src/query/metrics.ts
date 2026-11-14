// Metric catalogue (CONTRACTS section 5): names, units, plain-language labels.
export interface MetricDef {
  name: string;
  label: string;
  plain: string;
  unit: string;
  digits: number;
  kind: 'window' | 'static';
  /** can be used in filters / objectives */
  rankable: boolean;
  defaultOp?: '<' | '<=' | '>' | '>=';
  defaultValue?: number;
  /** only defined when query.power is set (power model) */
  needsPower?: boolean;
  /** only exists on the polar (20 m) index: always fails on the coarse global grid */
  polarOnly?: boolean;
}

const M = (name: string, label: string, plain: string, unit: string, digits: number, kind: 'window' | 'static', extra: Partial<MetricDef> = {}): MetricDef =>
  ({ name, label, plain, unit, digits, kind, rankable: true, ...extra });

export const METRICS: MetricDef[] = [
  M('sun_hours', 'Sun hours', 'Hours of sunlight', 'h', 0, 'window', { defaultOp: '>=', defaultValue: 100 }),
  M('sun_frac', 'Sun fraction', 'Share of time in sunlight', '', 2, 'window', { defaultOp: '>=', defaultValue: 0.5 }),
  M('longest_sun_h', 'Longest sunlit run', 'Longest unbroken daylight', 'h', 0, 'window', { defaultOp: '>=', defaultValue: 144 }),
  M('longest_dark_h', 'Longest dark run', 'Longest night', 'h', 0, 'window', { defaultOp: '<=', defaultValue: 48 }),
  M('earth_hours', 'Earth hours', 'Hours Earth is in view', 'h', 0, 'window', { defaultOp: '>=', defaultValue: 200 }),
  M('longest_earth_h', 'Longest Earth-up run', 'Longest unbroken Earth view', 'h', 0, 'window', { defaultOp: '>=', defaultValue: 144 }),
  M('longest_no_earth_h', 'Longest no-Earth run', 'Longest radio blackout', 'h', 0, 'window', { defaultOp: '<=', defaultValue: 48 }),
  M('both_hours', 'Sun+Earth hours', 'Hours with both Sun and Earth', 'h', 0, 'window', { defaultOp: '>=', defaultValue: 100 }),
  M('longest_both_h', 'Longest Sun+Earth run', 'Longest stretch of both', 'h', 0, 'window', { defaultOp: '>=', defaultValue: 144 }),
  M('mean_sun_el_deg', 'Mean Sun elevation', 'Average Sun height in sky', '°', 1, 'window', { defaultOp: '>=', defaultValue: 1 }),
  M('min_sun_el_deg', 'Min Sun elevation', 'Lowest Sun height in sky', '°', 1, 'window'),
  M('sun_disc_frac_mean', 'Sun disc visible', 'How much of the Sun is visible', '', 2, 'window', { defaultOp: '>=', defaultValue: 0.8 }),
  M('eclipse_hours', 'Eclipse hours', 'Hours Earth blocks the Sun', 'h', 1, 'window', { defaultOp: '<=', defaultValue: 0 }),
  M('comms_hours', 'Comms hours', 'Hours a Deep Space Network dish can hear the Moon and Earth is in view', 'h', 0, 'window', { defaultOp: '>=', defaultValue: 200 }),
  M('longest_comms_h', 'Longest comms run', 'Longest unbroken radio contact', 'h', 0, 'window', { defaultOp: '>=', defaultValue: 48 }),
  M('marginal_hours', 'Marginal-link hours', 'Hours Earth skims the skyline (weak, flickery link)', 'h', 0, 'window', { defaultOp: '<=', defaultValue: 24 }),
  M('energy_wh', 'Energy (power model)', 'Solar energy collected by your panel', 'Wh', 0, 'window', { defaultOp: '>=', defaultValue: 10000, needsPower: true }),
  M('battery_wh_needed', 'Battery needed', 'Battery size to survive the longest night', 'Wh', 0, 'window', { defaultOp: '<=', defaultValue: 5000, needsPower: true }),
  M('slope_deg', 'Slope', 'Steepness of ground', '°', 1, 'static', { defaultOp: '<=', defaultValue: 8 }),
  M('elev_m', 'Elevation', 'Height above lunar datum', 'm', 0, 'static'),
  M('psr_dist_km', 'Distance to PSR', 'Distance to permanent shadow', 'km', 1, 'static', { defaultOp: '<=', defaultValue: 5, polarOnly: true }),
  M('fault_dist_km', 'Distance to fault scarp', 'Distance to nearest young fault', 'km', 1, 'static', { defaultOp: '>=', defaultValue: 5, polarOnly: true }),
  M('lat', 'Latitude', 'Latitude', '°', 3, 'static', { rankable: false }),
  M('lon', 'Longitude', 'Longitude', '°', 3, 'static', { rankable: false }),
];

export const METRIC_BY_NAME: Record<string, MetricDef> = Object.fromEntries(METRICS.map((m) => [m.name, m]));
export const RANKABLE = METRICS.filter((m) => m.rankable);
export const TABLE_METRICS = METRICS.filter((m) => m.kind === 'window').map((m) => m.name);
export const STATIC_METRICS = ['elev_m', 'slope_deg', 'psr_dist_km', 'fault_dist_km'];

export function metricLabel(name: string, educator = false): string {
  const m = METRIC_BY_NAME[name];
  return m ? (educator ? m.plain : m.label) : name;
}

export function fmtMetric(name: string, v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  const m = METRIC_BY_NAME[name];
  const d = m?.digits ?? 1;
  const u = m?.unit ?? '';
  if (u === 'h' && Math.abs(v) >= 48) return `${v.toFixed(0)} h (${(v / 24).toFixed(1)} d)`;
  return `${v.toFixed(d)}${u ? (u === '°' ? u : ` ${u}`) : ''}`;
}
