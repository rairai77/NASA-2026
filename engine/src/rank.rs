//! rankCoarse / rankRefine / rankPoints (CONTRACTS §6-7).
use crate::bail;
use crate::ephem::Ephemeris;
use crate::error::Res;
use crate::geo::*;
use crate::index::Index;
use crate::metrics::{coarse_metrics, copy_bits, window_metrics, Metrics};
use crate::par::pmap;
use crate::query::*;
use crate::visibility::{series, Site};
use serde::{Deserialize, Serialize};

pub const N_CANDIDATES: usize = 50;
pub const REFINE_STEP_S: f64 = 900.0;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Candidate {
    pub cell: usize,
    pub lat: f64,
    pub lon: f64,
    pub metrics: Metrics,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CoarseStats {
    pub considered: usize,
    pub passed_filters: usize,
    pub window_steps: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CoarseResult {
    pub candidates: Vec<Candidate>,
    pub bands_needed: Vec<usize>,
    pub stats: CoarseStats,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RankItem {
    pub rank: usize,
    pub cell: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub metrics: Metrics,
    pub coarse_metrics: Metrics,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RankResult {
    pub results: Vec<RankItem>,
    pub considered: usize,
    pub passed_filters: usize,
    pub resolution_m: f64,
    pub model: &'static str,
}

pub struct PointIn {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
    pub elev_deg: Vec<f32>,
    pub site_elev_m: f64,
}

/// Metrics for a site with a known horizon over a window (fine series).
pub fn point_metrics(eph: &Ephemeris, lat: f64, lon: f64, z_m: f64, h: f64, hz: &[f32], t0: f64, t1: f64, step_s: f64) -> Res<Metrics> {
    let site = Site::new(lat, lon, R + z_m + h);
    let s = series(eph, &site, hz, t0, t1, step_s)?;
    Ok(window_metrics(&s))
}

const STATIC_KEYS: &[&str] = &["lat", "lon", "elev_m", "slope_deg", "psr_dist_km", "fault_dist_km"];

fn static_metrics(ix: &Index, c: usize) -> Metrics {
    let mut m = Metrics::new();
    for k in STATIC_KEYS {
        if let Some(v) = ix.static_value(k, c) {
            m.insert((*k).to_string(), v);
        }
    }
    m
}

pub fn rank_coarse(ix: &Index, q: &ParsedQuery) -> Res<CoarseResult> {
    if ix.statics.is_empty() {
        bail!("index static columns not loaded (call loadIndexStatic first)");
    }
    let spans = ix.month_spans(q.t_start, q.t_end)?;
    for (mi, _, _) in &spans {
        let name = &ix.months[*mi].month;
        if !ix.month_data.contains_key(name) {
            bail!("index month {name} not loaded");
        }
    }
    let n_steps: usize = spans.iter().map(|s| s.2 - s.1).sum();
    let ncells = ix.ncells();

    // region mask
    let center = match &q.region {
        Region::Circle { lat, lon, .. } => Some(unit_from_latlon(*lat, *lon)),
        _ => None,
    };
    let mut cells: Vec<usize> = Vec::new();
    for c in 0..ncells {
        if !ix.valid[c] {
            continue;
        }
        let ok = match &q.region {
            Region::Polar { min_lat, max_lat } => ix.lat[c] >= *min_lat && ix.lat[c] <= *max_lat,
            Region::Circle { radius_km, .. } => gc_dist_m(&ix.cell_unit(c), center.as_ref().unwrap()) <= radius_km * 1000.0,
            Region::Sites { .. } => bail!("region.type 'sites' is ranked with rankPoints, not rankCoarse"),
            Region::Global => bail!("region.type 'global' is not supported by the polar index"),
        };
        // statics may mark cells invalid with NaN
        if ok && ix.static_value("elev_m", c).is_some() {
            cells.push(c);
        }
    }
    let considered = cells.len();

    // filters usable at the coarse stage
    let coarse_filters: Vec<_> = q.filters.iter().filter(|f| is_coarse_metric(&f.0)).cloned().collect();
    let (static_f, bit_f): (Vec<_>, Vec<_>) = coarse_filters.into_iter().partition(|f| STATIC_METRICS.contains(&f.0.as_str()));
    let cells: Vec<usize> = cells
        .into_iter()
        .filter(|&c| static_f.iter().all(|(n, op, v)| ix.static_value(n, c).map_or(false, |x| op.eval(x, *v))))
        .collect();

    let nw = (n_steps + 63) / 64;
    let evaluated: Vec<Option<Metrics>> = pmap(&cells, |&c| {
        let mut sun = vec![0u64; nw];
        let mut earth = vec![0u64; nw];
        let mut pos = 0;
        for &(mi, lo, hi) in &spans {
            let d = &ix.month_data[&ix.months[mi].month];
            let w = ix.months[mi].words;
            copy_bits(&mut sun, pos, &d[c * w..(c + 1) * w], lo, hi - lo);
            let eo = ncells * w; // Earth block follows the Sun block
            copy_bits(&mut earth, pos, &d[eo + c * w..eo + (c + 1) * w], lo, hi - lo);
            pos += hi - lo;
        }
        let m = coarse_metrics(&sun, &earth, n_steps, ix.step_s);
        if passes(&bit_f, &m) {
            Some(m)
        } else {
            None
        }
    });
    let survivors: Vec<(usize, Metrics)> = cells
        .iter()
        .zip(evaluated)
        .filter_map(|(&c, m)| m.map(|mut m| {
            m.extend(static_metrics(ix, c));
            (c, m)
        }))
        .collect();
    let passed = survivors.len();

    // objectives available coarsely; default to sun_hours if none remain
    let mut objs: Vec<(String, bool)> = q.objectives.iter().filter(|o| is_coarse_metric(&o.0)).cloned().collect();
    let mut weights: Vec<f64> = q
        .objectives
        .iter()
        .zip(&q.weights)
        .filter(|(o, _)| is_coarse_metric(&o.0))
        .map(|(_, w)| *w)
        .collect();
    if objs.is_empty() {
        objs.push(("sun_hours".into(), true));
        weights = vec![1.0];
    }
    let refs: Vec<&Metrics> = survivors.iter().map(|s| &s.1).collect();
    let order = sort_order(&refs, &objs, q.weighted, &weights);
    let keep = nms(&order, &|i| ix.cell_unit(survivors[i].0), q.min_sep_m, N_CANDIDATES);

    let mut candidates = Vec::new();
    let mut bands: Vec<usize> = Vec::new();
    for i in keep {
        let (c, m) = &survivors[i];
        let b = ix.band_of_cell(*c);
        if !bands.contains(&b) {
            bands.push(b);
        }
        candidates.push(Candidate { cell: *c, lat: ix.lat[*c], lon: wrap180(ix.lon[*c]), metrics: m.clone() });
    }
    bands.sort_unstable();
    Ok(CoarseResult { candidates, bands_needed: bands, stats: CoarseStats { considered, passed_filters: passed, window_steps: n_steps } })
}

/// Common tail of refine/points: filter, sort, NMS, truncate to k.
fn finish(
    q: &ParsedQuery,
    items: Vec<(usize, Option<String>, f64, f64, Metrics, Metrics)>, // cell,id,lat,lon,metrics,coarse
    pos: &dyn Fn(usize) -> V3,
    resolution_m: f64,
) -> RankResult {
    let considered = items.len();
    let items: Vec<_> = items.into_iter().filter(|it| passes(&q.filters, &it.4)).collect();
    let passed = items.len();
    let refs: Vec<&Metrics> = items.iter().map(|i| &i.4).collect();
    let order = sort_order(&refs, &q.objectives, q.weighted, &q.weights);
    let keep = nms(&order, &|i| pos(i), q.min_sep_m, q.k);
    let mut items: Vec<Option<_>> = items.into_iter().map(Some).collect();
    let results = keep
        .into_iter()
        .enumerate()
        .map(|(r, i)| {
            let (cell, id, lat, lon, metrics, coarse) = items[i].take().unwrap();
            RankItem { rank: r + 1, cell, id, lat: wrap180(lat), lon: wrap180(lon), metrics, coarse_metrics: coarse }
        })
        .collect();
    RankResult { results, considered, passed_filters: passed, resolution_m, model: "terrain" }
}

pub fn rank_refine(ix: &Index, eph: &Ephemeris, q: &ParsedQuery, cands: &[Candidate]) -> Res<RankResult> {
    if cands.is_empty() {
        return Ok(RankResult { results: vec![], considered: 0, passed_filters: 0, resolution_m: ix.grid.cell_m, model: "terrain" });
    }
    let rows: Vec<Res<(Metrics, Metrics)>> = pmap(cands, |c| {
        if c.cell >= ix.ncells() {
            bail!("candidate cell {} out of range", c.cell);
        }
        let hz = ix.cell_horizon(c.cell)?;
        let z = ix.static_value("elev_m", c.cell).unwrap_or(0.0);
        let mut m = point_metrics(eph, ix.lat[c.cell], ix.lon[c.cell], z, q.height_m, &hz, q.t_start, q.t_end, REFINE_STEP_S)?;
        m.extend(static_metrics(ix, c.cell));
        Ok((m, c.metrics.clone()))
    });
    let mut items = Vec::new();
    for (c, r) in cands.iter().zip(rows) {
        let (m, coarse) = r?;
        items.push((c.cell, None, ix.lat[c.cell], ix.lon[c.cell], m, coarse));
    }
    let cells: Vec<usize> = items.iter().map(|i| i.0).collect();
    Ok(finish(q, items, &|i| ix.cell_unit(cells[i]), ix.grid.cell_m))
}

pub fn rank_points(eph: &Ephemeris, q: &ParsedQuery, pts: &[PointIn], resolution_m: f64) -> Res<RankResult> {
    let rows: Vec<Res<Metrics>> = pmap(pts, |p| {
        if p.elev_deg.len() < 4 {
            bail!("point '{}': horizon needs at least 4 azimuth bins", p.id);
        }
        let mut m = point_metrics(eph, p.lat, p.lon, p.site_elev_m, q.height_m, &p.elev_deg, q.t_start, q.t_end, REFINE_STEP_S)?;
        m.insert("lat".into(), p.lat);
        m.insert("lon".into(), wrap180(p.lon));
        m.insert("elev_m".into(), p.site_elev_m);
        Ok(m)
    });
    let mut items = Vec::new();
    for (i, (p, r)) in pts.iter().zip(rows).enumerate() {
        items.push((i, Some(p.id.clone()), p.lat, p.lon, r?, Metrics::new()));
    }
    Ok(finish(q, items, &|i| unit_from_latlon(pts[i].lat, pts[i].lon), resolution_m))
}
