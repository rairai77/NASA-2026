// Validation of the LLM's `set_query` tool arguments (CONTRACTS section 6).
// Keeps valid parts, moves invalid ones to `warnings`. Pure, no Cloudflare APIs.

export const WINDOW_METRICS = [
  "sun_hours", "sun_frac", "longest_sun_h", "longest_dark_h", "earth_hours",
  "longest_earth_h", "longest_no_earth_h", "both_hours", "longest_both_h",
  "mean_sun_el_deg", "min_sun_el_deg", "sun_disc_frac_mean", "eclipse_hours",
  "comms_hours", "longest_comms_h", "marginal_hours",
  "energy_wh", "battery_wh_needed",
] as const;
export const STATIC_METRICS = ["lat", "lon", "elev_m", "slope_deg", "psr_dist_km", "fault_dist_km"] as const;
export const METRICS: readonly string[] = [...WINDOW_METRICS, ...STATIC_METRICS];
export const OPS = ["<", "<=", ">", ">="] as const;
export const DIRS = ["max", "min"] as const;
export const REGION_TYPES = ["polar", "circle", "sites", "bbox", "global"] as const;
export const PANEL_KINDS = ["vertical_fixed", "vertical_tracking", "horizontal"] as const;
/** Metrics that only exist when query.power is set. */
export const POWER_METRICS = ["energy_wh", "battery_wh_needed"] as const;
/** Metrics that do not exist on the coarse global grid (outside the south polar cap). */
export const POLAR_ONLY_METRICS = ["psr_dist_km", "fault_dist_km"] as const;

export interface ValidationResult {
  query: Record<string, unknown>;
  unparsed: string[];
  warnings: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Parses YYYY-MM-DD or ISO-8601 UTC; returns ms since epoch or null. */
export function parseTime(s: unknown): number | null {
  if (typeof s !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]00:?00)?)?$/.test(s.trim())) return null;
  const iso = s.trim().replace(" ", "T");
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + "T00:00:00Z" : /Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
  return Number.isNaN(t) ? null : t;
}

export function validateToolArgs(raw: unknown): ValidationResult {
  const query: Obj = {};
  const warnings: string[] = [];
  const unparsed: string[] = [];
  if (!isObj(raw)) {
    return { query, unparsed, warnings: ["model returned no usable arguments"] };
  }

  if (Array.isArray(raw.unparsed)) {
    for (const u of raw.unparsed) if (typeof u === "string" && u.trim()) unparsed.push(u.trim().slice(0, 200));
  }

  // window
  if (raw.window !== undefined && raw.window !== null) {
    const w = raw.window;
    const s = isObj(w) ? parseTime(w.start) : null;
    const e = isObj(w) ? parseTime(w.end) : null;
    if (s === null || e === null) warnings.push("window dropped: start/end must be YYYY-MM-DD or ISO-8601 UTC");
    else if (s >= e) warnings.push("window dropped: start must be before end");
    else query.window = { start: (w as Obj).start, end: (w as Obj).end };
  }

  // region
  if (raw.region !== undefined && raw.region !== null) {
    const r = raw.region;
    const t = isObj(r) ? r.type : undefined;
    if (!isObj(r) || !(REGION_TYPES as readonly unknown[]).includes(t)) {
      warnings.push(`region dropped: unknown type '${String(t)}'`);
    } else if (t === "polar") {
      const a = num(r.min_lat), b = num(r.max_lat);
      if (a === null || b === null) warnings.push("region dropped: polar needs numeric min_lat and max_lat");
      else {
        const lo = clamp(Math.min(a, b), -90, 90), hi = clamp(Math.max(a, b), -90, 90);
        if (lo === hi) warnings.push("region dropped: empty latitude band");
        else query.region = { type: "polar", min_lat: lo, max_lat: hi };
      }
    } else if (t === "circle") {
      const lat = num(r.lat), lon = num(r.lon), rad = num(r.radius_km);
      if (lat === null || lon === null || rad === null || lat < -90 || lat > 90 || rad <= 0) {
        warnings.push("region dropped: circle needs lat in [-90,90], lon and radius_km > 0");
      } else {
        const l = Math.round((((lon + 180) % 360 + 360) % 360 - 180) * 1e6) / 1e6;
        query.region = { type: "circle", lat, lon: l, radius_km: Math.min(rad, 2000) };
      }
    } else if (t === "global") {
      query.region = { type: "global" };
    } else if (t === "bbox") {
      const w = num(r.west), so = num(r.south), e = num(r.east), n = num(r.north);
      if (w === null || so === null || e === null || n === null) warnings.push("region dropped: bbox needs numeric west, south, east, north");
      else if (so < -90 || n > 90 || so >= n) warnings.push("region dropped: bbox needs -90 <= south < north <= 90");
      else {
        const wrap = (x: number) => Math.round((((x + 180) % 360 + 360) % 360 - 180) * 1e6) / 1e6;
        // full-width boxes keep their meaning (wrapping would collapse 360 degrees to zero width)
        if (e - w >= 360) query.region = { type: "bbox", west: -180, south: so, east: 180, north: n };
        else query.region = { type: "bbox", west: wrap(w), south: so, east: wrap(e), north: n };
      }
    } else {
      const ids = Array.isArray(r.ids) ? r.ids.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(x)) : [];
      const dropped = (Array.isArray(r.ids) ? r.ids.length : 0) - ids.length;
      if (dropped > 0) warnings.push(`${dropped} invalid site id(s) dropped`);
      if (ids.length === 0) warnings.push("region dropped: no valid site ids");
      else query.region = { type: "sites", ids: [...new Set(ids)].slice(0, 20) };
    }
  }

  // height
  if (raw.height_m !== undefined && raw.height_m !== null) {
    const h = num(raw.height_m);
    if (h === null || h < 0 || h > 100) warnings.push("height_m dropped: must be a number in [0,100]");
    else query.height_m = h;
  }

  // filters
  if (Array.isArray(raw.filters)) {
    const out: Obj[] = [];
    for (const f of raw.filters) {
      const m = isObj(f) ? f.metric : undefined;
      if (!isObj(f) || typeof m !== "string" || !METRICS.includes(m)) {
        warnings.push(`unknown metric '${String(m)}' dropped from filters`);
        continue;
      }
      if (!(OPS as readonly unknown[]).includes(f.op)) {
        warnings.push(`filter on '${m}' dropped: bad operator '${String(f.op)}'`);
        continue;
      }
      const v = num(f.value);
      if (v === null) {
        warnings.push(`filter on '${m}' dropped: value is not a number`);
        continue;
      }
      out.push({ metric: m, op: f.op, value: v });
    }
    if (out.length) query.filters = out;
  } else if (raw.filters !== undefined && raw.filters !== null) {
    warnings.push("filters dropped: not a list");
  }

  // objectives
  if (Array.isArray(raw.objectives)) {
    const out: Obj[] = [];
    for (const o of raw.objectives) {
      const m = isObj(o) ? o.metric : undefined;
      if (!isObj(o) || typeof m !== "string" || !METRICS.includes(m)) {
        warnings.push(`unknown metric '${String(m)}' dropped from objectives`);
        continue;
      }
      if (!(DIRS as readonly unknown[]).includes(o.dir)) {
        warnings.push(`objective on '${m}' dropped: dir must be max or min`);
        continue;
      }
      if (out.some((x) => x.metric === m)) continue;
      out.push({ metric: m, dir: o.dir });
    }
    if (out.length) query.objectives = out;
  } else if (raw.objectives !== undefined && raw.objectives !== null) {
    warnings.push("objectives dropped: not a list");
  }

  // mode / weights
  if (raw.mode !== undefined && raw.mode !== null) {
    if (raw.mode === "lexicographic" || raw.mode === "weighted") query.mode = raw.mode;
    else warnings.push(`mode '${String(raw.mode)}' dropped`);
  }
  if (Array.isArray(raw.weights)) {
    const ws = raw.weights.map(num);
    const nObj = Array.isArray(query.objectives) ? query.objectives.length : -1;
    if (ws.some((x) => x === null || (x as number) < 0) || ws.length !== nObj) {
      warnings.push("weights dropped: must be non-negative numbers, one per objective");
    } else query.weights = ws;
  }
  if (query.mode === "weighted" && !query.weights) {
    delete query.mode;
    warnings.push("weighted mode dropped: no valid weights");
  }

  // k, separation
  if (raw.k !== undefined && raw.k !== null) {
    const k = num(raw.k);
    if (k === null) warnings.push("k dropped: not a number");
    else {
      const c = clamp(Math.round(k), 1, 20);
      if (c !== k) warnings.push(`k clamped to ${c}`);
      query.k = c;
    }
  }
  if (raw.min_separation_km !== undefined && raw.min_separation_km !== null) {
    const d = num(raw.min_separation_km);
    if (d === null || d < 0) warnings.push("min_separation_km dropped: must be a number >= 0");
    else query.min_separation_km = Math.min(d, 500);
  }

  // relay
  if (raw.relay !== undefined && raw.relay !== null) {
    if (typeof raw.relay === "boolean") query.relay = raw.relay;
    else warnings.push("relay dropped: must be true or false");
  }

  // power panel
  if (isObj(raw.power)) {
    const p = raw.power;
    const kind = typeof p.kind === "string" ? p.kind : "vertical_tracking";
    const area = p.areaM2 === undefined ? 3 : num(p.areaM2);
    const eff = p.efficiency === undefined ? 0.3 : num(p.efficiency);
    const load = p.loadW === undefined ? 150 : num(p.loadW);
    const dod = p.depthOfDischarge === undefined ? 0.8 : num(p.depthOfDischarge);
    const bat = p.batteryWh === undefined || p.batteryWh === null ? undefined : num(p.batteryWh);
    const az = p.azimuthDeg === undefined || p.azimuthDeg === null ? undefined : num(p.azimuthDeg);
    if (!(PANEL_KINDS as readonly string[]).includes(kind)) warnings.push(`power dropped: unknown panel kind '${kind}'`);
    else if (area === null || area <= 0 || area > 1000 || eff === null || eff <= 0 || eff > 1 || load === null || load < 0 || load > 1e6 ||
      dod === null || dod <= 0 || dod > 1 || bat === null || (bat !== undefined && (bat < 0 || bat > 1e8)) || az === null) {
      warnings.push("power dropped: need areaM2 in (0,1000], efficiency in (0,1], loadW >= 0, depthOfDischarge in (0,1], batteryWh >= 0");
    } else {
      const panel: Obj = { kind, areaM2: area, efficiency: eff, loadW: load, depthOfDischarge: dod };
      if (bat !== undefined) panel.batteryWh = bat;
      if (az !== undefined && kind === "vertical_fixed") panel.azimuthDeg = ((az % 360) + 360) % 360;
      query.power = panel;
    }
  } else if (raw.power !== undefined && raw.power !== null) {
    warnings.push("power dropped: not an object");
  }

  // power metrics need a panel: attach the default lander panel rather than silently dropping the chip
  if (!query.power) {
    const uses = [...(Array.isArray(query.filters) ? query.filters : []), ...(Array.isArray(query.objectives) ? query.objectives : [])]
      .some((x) => (POWER_METRICS as readonly unknown[]).includes((x as Obj).metric));
    if (uses) {
      query.power = { kind: "vertical_tracking", areaM2: 3, efficiency: 0.3, loadW: 150, depthOfDischarge: 0.8, batteryWh: 2000 };
      warnings.push("power metric used without a panel: assumed 3 m2 sun-tracking vertical panel, 0.3 efficiency, 150 W load, 2000 Wh battery");
    }
  }

  // psr/fault distances exist only on the 20 m polar index
  const reg = query.region as Obj | undefined;
  const coarse = reg && (reg.type === "global" || (reg.type === "bbox" && (reg.north as number) > -85) || (reg.type === "polar" && (reg.max_lat as number) > -85) ||
    (reg.type === "circle" && ((reg.lat as number) + (reg.radius_km as number) / 111.195 > -85 || (reg.lat as number) > -85)));
  if (coarse && Array.isArray(query.filters) && query.filters.some((f) => (POLAR_ONLY_METRICS as readonly unknown[]).includes((f as Obj).metric))) {
    warnings.push("psr_dist_km / fault_dist_km filters only work in the south polar cap (below -85 deg); in this region they will remove every result");
  }

  return { query, unparsed, warnings };
}
