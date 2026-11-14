//! Query schema (CONTRACTS §6), metric catalogue, filter/sort helpers, NMS.
use crate::bail;
use crate::error::Res;
use crate::geo::{gc_dist_m, V3};
use crate::metrics::Metrics;
use serde::Deserialize;
use std::cmp::Ordering;

#[derive(Deserialize, Clone, Debug)]
#[serde(untagged)]
pub enum TimeSpec {
    Num(f64),
    Str(String),
}

#[derive(Deserialize, Clone, Debug)]
pub struct Window {
    pub start: TimeSpec,
    pub end: TimeSpec,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Region {
    Polar { min_lat: f64, max_lat: f64 },
    Circle { lat: f64, lon: f64, radius_km: f64 },
    Sites { ids: Vec<String> },
    Bbox { west: f64, south: f64, east: f64, north: f64 },
    Global,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Filter {
    pub metric: String,
    pub op: String,
    pub value: f64,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Objective {
    pub metric: String,
    pub dir: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Query {
    pub window: Window,
    pub region: Option<Region>,
    pub height_m: Option<f64>,
    #[serde(default)]
    pub filters: Vec<Filter>,
    #[serde(default)]
    pub objectives: Vec<Objective>,
    pub mode: Option<String>,
    pub weights: Option<Vec<f64>>,
    pub k: Option<usize>,
    pub min_separation_km: Option<f64>,
    /// Optional power model; enables `energy_wh` and `battery_wh_needed`.
    pub power: Option<crate::power::Panel>,
    /// Assume a relay: comms always available (comms metrics = window hours).
    #[serde(default)]
    pub relay: bool,
}

pub struct ParsedQuery {
    pub t_start: f64,
    pub t_end: f64,
    pub region: Region,
    pub height_m: f64,
    pub filters: Vec<(String, Op, f64)>,
    pub objectives: Vec<(String, bool)>, // (metric, maximise)
    pub weighted: bool,
    pub weights: Vec<f64>,
    pub k: usize,
    pub min_sep_m: f64,
    pub power: Option<crate::power::Panel>,
    pub relay: bool,
}

#[derive(Clone, Copy, Debug)]
pub enum Op {
    Lt,
    Le,
    Gt,
    Ge,
}

impl Op {
    pub fn eval(self, a: f64, b: f64) -> bool {
        match self {
            Op::Lt => a < b,
            Op::Le => a <= b,
            Op::Gt => a > b,
            Op::Ge => a >= b,
        }
    }
}

pub const STATIC_METRICS: &[&str] = &["lat", "lon", "elev_m", "slope_deg", "psr_dist_km", "fault_dist_km"];
pub const COARSE_METRICS: &[&str] = &[
    "sun_hours", "sun_frac", "earth_hours", "both_hours", "longest_sun_h", "longest_dark_h", "longest_earth_h",
    "longest_no_earth_h", "longest_both_h",
];
pub const FINE_ONLY_METRICS: &[&str] = &["mean_sun_el_deg", "min_sun_el_deg", "sun_disc_frac_mean", "eclipse_hours", "energy_wh", "battery_wh_needed", "comms_hours", "longest_comms_h", "marginal_hours"];

pub fn is_known_metric(m: &str) -> bool {
    STATIC_METRICS.contains(&m) || COARSE_METRICS.contains(&m) || FINE_ONLY_METRICS.contains(&m)
}
pub fn is_coarse_metric(m: &str) -> bool {
    STATIC_METRICS.contains(&m) || COARSE_METRICS.contains(&m)
}

/// Rounding bucket for lexicographic comparison (0 = none).
fn rounding(metric: &str) -> f64 {
    match metric {
        "sun_frac" | "sun_disc_frac_mean" => 0.01,
        m if m.ends_with("_hours") || m.ends_with("_h") => 3.0,
        m if m.ends_with("_deg") && m != "slope_deg" => 0.5,
        m if m.ends_with("_km") => 0.5,
        "slope_deg" => 0.5,
        _ => 0.0,
    }
}

pub fn parse_time(s: &str) -> Res<f64> {
    let s = s.trim();
    let bad = || crate::error::EngineError(format!("cannot parse time '{s}' (use YYYY-MM-DD or ISO-8601 UTC)"));
    let (date, time) = match s.find(|c| c == 'T' || c == ' ') {
        Some(i) => (&s[..i], Some(&s[i + 1..])),
        None => (s, None),
    };
    let mut it = date.split('-');
    let y: i64 = it.next().and_then(|x| x.parse().ok()).ok_or_else(bad)?;
    let mo: i64 = it.next().and_then(|x| x.parse().ok()).ok_or_else(bad)?;
    let d: i64 = it.next().and_then(|x| x.parse().ok()).ok_or_else(bad)?;
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return Err(bad());
    }
    let mut secs = days_from_civil(y, mo, d) as f64 * 86400.0;
    if let Some(t) = time {
        let mut t = t.trim_end_matches('Z').trim();
        let mut off = 0.0;
        if let Some(i) = t.rfind(|c| c == '+' || c == '-') {
            if i > 0 {
                let tz = &t[i + 1..];
                let sign = if &t[i..i + 1] == "-" { -1.0 } else { 1.0 };
                let mut z = tz.split(':');
                let hh: f64 = z.next().and_then(|x| x.parse().ok()).ok_or_else(bad)?;
                let mm: f64 = z.next().map(|x| x.parse().unwrap_or(0.0)).unwrap_or(0.0);
                off = sign * (hh * 3600.0 + mm * 60.0);
                t = &t[..i];
            }
        }
        let mut p = t.split(':');
        let hh: f64 = p.next().and_then(|x| x.parse().ok()).ok_or_else(bad)?;
        let mm: f64 = p.next().map(|x| x.parse().unwrap_or(0.0)).unwrap_or(0.0);
        let ss: f64 = p.next().map(|x| x.parse().unwrap_or(0.0)).unwrap_or(0.0);
        secs += hh * 3600.0 + mm * 60.0 + ss - off;
    }
    Ok(secs)
}

/// Days since 1970-01-01 for a proleptic Gregorian date.
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

impl TimeSpec {
    pub fn to_unix(&self) -> Res<f64> {
        match self {
            TimeSpec::Num(x) => Ok(*x),
            TimeSpec::Str(s) => parse_time(s),
        }
    }
}

impl Query {
    pub fn parse(&self, default_height: f64) -> Res<ParsedQuery> {
        let t_start = self.window.start.to_unix()?;
        let t_end = self.window.end.to_unix()?;
        if !(t_end > t_start) {
            bail!("window.end must be after window.start");
        }
        let mut filters = Vec::new();
        for f in &self.filters {
            if !is_known_metric(&f.metric) {
                bail!("unknown filter metric '{}'", f.metric);
            }
            let op = match f.op.as_str() {
                "<" => Op::Lt,
                "<=" => Op::Le,
                ">" => Op::Gt,
                ">=" => Op::Ge,
                o => bail!("unknown filter op '{o}'"),
            };
            filters.push((f.metric.clone(), op, f.value));
        }
        let mut objectives = Vec::new();
        for o in &self.objectives {
            if !is_known_metric(&o.metric) {
                bail!("unknown objective metric '{}'", o.metric);
            }
            objectives.push((
                o.metric.clone(),
                match o.dir.as_str() {
                    "max" => true,
                    "min" => false,
                    d => bail!("unknown objective dir '{d}'"),
                },
            ));
        }
        let weighted = match self.mode.as_deref() {
            None | Some("lexicographic") => false,
            Some("weighted") => true,
            Some(m) => bail!("unknown mode '{m}'"),
        };
        let weights = match (&self.weights, weighted) {
            (Some(w), _) => {
                if w.len() != objectives.len() {
                    bail!("weights must have the same length as objectives");
                }
                w.clone()
            }
            (None, _) => vec![1.0; objectives.len()],
        };
        let region = self.region.clone().unwrap_or(Region::Polar { min_lat: -90.0, max_lat: -85.0 });
        Ok(ParsedQuery {
            t_start,
            t_end,
            region,
            height_m: self.height_m.unwrap_or(default_height),
            filters,
            objectives,
            weighted,
            weights,
            k: self.k.unwrap_or(5).max(1),
            min_sep_m: self.min_separation_km.unwrap_or(2.0).max(0.0) * 1000.0,
            power: self.power.clone(),
            relay: self.relay,
        })
    }
}

/// Look up a metric; None if unavailable (treated as failing filters / worst in sort).
pub fn metric_value(m: &Metrics, name: &str) -> Option<f64> {
    m.get(name).copied().filter(|v| v.is_finite())
}

/// All filters must hold; a missing metric fails the filter.
pub fn passes(filters: &[(String, Op, f64)], m: &Metrics) -> bool {
    filters.iter().all(|(name, op, v)| metric_value(m, name).map_or(false, |x| op.eval(x, *v)))
}

/// Order candidates best-first. `objs` = (metric, maximise). Returns indices.
pub fn sort_order(items: &[&Metrics], objs: &[(String, bool)], weighted: bool, weights: &[f64]) -> Vec<usize> {
    let n = items.len();
    let mut idx: Vec<usize> = (0..n).collect();
    if objs.is_empty() {
        return idx;
    }
    if weighted {
        // min-max normalise each objective across the set; missing -> 0
        let mut score = vec![0.0f64; n];
        for (oi, (name, maxi)) in objs.iter().enumerate() {
            let vals: Vec<Option<f64>> = items.iter().map(|m| metric_value(m, name)).collect();
            let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
            for v in vals.iter().flatten() {
                lo = lo.min(*v);
                hi = hi.max(*v);
            }
            for (i, v) in vals.iter().enumerate() {
                let norm = match v {
                    Some(x) if hi > lo => (x - lo) / (hi - lo),
                    Some(_) => 1.0,
                    None => 0.0,
                };
                score[i] += weights.get(oi).copied().unwrap_or(1.0) * if *maxi { norm } else { 1.0 - norm };
            }
        }
        idx.sort_by(|&a, &b| score[b].partial_cmp(&score[a]).unwrap_or(Ordering::Equal).then(a.cmp(&b)));
        return idx;
    }
    let key = |i: usize, name: &str, round: bool| -> Option<f64> {
        metric_value(items[i], name).map(|v| {
            let r = rounding(name);
            if round && r > 0.0 {
                (v / r).round() * r
            } else {
                v
            }
        })
    };
    // compare in objective order after rounding; then raw values; then index
    let cmp_obj = |a: usize, b: usize, round: bool| -> Ordering {
        for (name, maxi) in objs {
            let (ka, kb) = (key(a, name, round), key(b, name, round));
            let o = match (ka, kb) {
                (Some(x), Some(y)) => {
                    let o = x.partial_cmp(&y).unwrap_or(Ordering::Equal);
                    if *maxi {
                        o.reverse()
                    } else {
                        o
                    }
                }
                (Some(_), None) => Ordering::Less,
                (None, Some(_)) => Ordering::Greater,
                (None, None) => Ordering::Equal,
            };
            if o != Ordering::Equal {
                return o;
            }
        }
        Ordering::Equal
    };
    idx.sort_by(|&a, &b| cmp_obj(a, b, true).then_with(|| cmp_obj(a, b, false)).then(a.cmp(&b)));
    idx
}

/// Greedy non-maximum suppression: keep points in order unless within
/// `min_sep_m` of an already kept point; stop at `limit`.
pub fn nms(order: &[usize], pos: &dyn Fn(usize) -> V3, min_sep_m: f64, limit: usize) -> Vec<usize> {
    let mut kept: Vec<(usize, V3)> = Vec::new();
    for &i in order {
        if kept.len() >= limit {
            break;
        }
        let p = pos(i);
        if min_sep_m > 0.0 && kept.iter().any(|(_, q)| gc_dist_m(&p, q) < min_sep_m) {
            continue;
        }
        kept.push((i, p));
    }
    kept.into_iter().map(|(i, _)| i).collect()
}
