//! Time-dependent rover traverse planner: A* on a local gnomonic grid with
//! slope limits and hourly sunlight/Earth-view slices from the shadow sweep.
use crate::bail;
use crate::engine::Engine;
use crate::error::Res;
use crate::geo::*;
use crate::patch::{shadow, PatchGrid};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

pub const MAX_SIZE_M: f64 = 15_000.0;
pub const SLICE_S: f64 = 3600.0;

#[derive(Deserialize, Clone, Copy, Debug)]
pub struct LatLon {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub max_slope_deg: f64,
    pub speed_mps: f64,
    #[serde(default)]
    pub require_sun: bool,
    #[serde(default)]
    pub require_earth: bool,
    pub max_hours: f64,
}

#[derive(Serialize, Debug)]
pub struct PathPoint {
    pub lat: f64,
    pub lon: f64,
    pub t: f64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TraverseResult {
    pub path: Vec<PathPoint>,
    pub distance_m: f64,
    pub duration_s: f64,
    pub sunlit_frac: f64,
    pub earth_frac: f64,
    /// "ok" | "no_path" | "timeout"
    pub status: String,
    pub cell_m: f64,
    pub px: usize,
}

/// Grid for a traverse: (centre lat, centre lon, size km, px).
pub fn grid_spec(a: LatLon, b: LatLon, cell_m: Option<f64>) -> Res<(f64, f64, f64, usize)> {
    let ua = unit_from_latlon(a.lat, a.lon);
    let ub = unit_from_latlon(b.lat, b.lon);
    let mut m = [ua[0] + ub[0], ua[1] + ub[1], ua[2] + ub[2]];
    let l = norm(&m);
    if l < 1e-9 {
        bail!("start and goal are antipodal");
    }
    m = scale(&m, 1.0 / l);
    let (clat, clon) = latlon_from_unit(&m);
    let dist = gc_dist_m(&ua, &ub);
    let size = 2.0 * (dist / 2.0 + (0.3 * dist).max(1500.0));
    if size > MAX_SIZE_M * 1.0001 && dist + 1000.0 > MAX_SIZE_M {
        bail!("start and goal are {:.1} km apart; the traverse planner is limited to about {:.0} km", dist / 1000.0, MAX_SIZE_M / 1000.0 - 1.0);
    }
    let size = size.min(MAX_SIZE_M).max(1000.0);
    let cell = cell_m.unwrap_or(20.0).max(1.0).max(size / 512.0);
    let px = (size / cell).ceil() as usize;
    Ok((clat, clon, px as f64 * cell / 1000.0, px))
}

struct Node {
    f: f64,
    t: f64,
    idx: usize,
}
impl PartialEq for Node {
    fn eq(&self, o: &Self) -> bool {
        self.f == o.f
    }
}
impl Eq for Node {}
impl PartialOrd for Node {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Node {
    fn cmp(&self, o: &Self) -> Ordering {
        o.f.partial_cmp(&self.f).unwrap_or(Ordering::Equal)
    }
}

struct Slices<'a> {
    eng: &'a Engine,
    g: &'a PatchGrid,
    t0: f64,
    sun: Vec<Option<Vec<u8>>>,
    earth: Vec<Option<Vec<u8>>>,
}

impl<'a> Slices<'a> {
    fn idx(&self, t: f64) -> usize {
        (((t - self.t0) / SLICE_S).floor().max(0.0) as usize).min(self.sun.len() - 1)
    }
    fn ensure(&mut self, s: usize, earth: bool) -> Res<()> {
        let slot_missing = if earth { self.earth[s].is_none() } else { self.sun[s].is_none() };
        if slot_missing {
            let t = self.t0 + s as f64 * SLICE_S + SLICE_S / 2.0;
            let (sg, su, eg, eu) = self.eng.body_geoms(self.g.lat, self.g.lon, t)?;
            let terr = self.eng.terr_ref()?;
            if earth {
                self.earth[s] = Some(shadow(terr, self.g, &eu, &eg));
            } else {
                self.sun[s] = Some(shadow(terr, self.g, &su, &sg));
            }
        }
        Ok(())
    }
    fn sun_lit(&mut self, c: usize, t: f64) -> Res<bool> {
        let s = self.idx(t);
        self.ensure(s, false)?;
        Ok(self.sun[s].as_ref().unwrap()[c * 2] >= 128)
    }
    fn earth_up(&mut self, c: usize, t: f64) -> Res<bool> {
        let s = self.idx(t);
        self.ensure(s, true)?;
        Ok(self.earth[s].as_ref().unwrap()[c * 2] >= 128)
    }
}

impl Engine {
    pub fn required_tiles_traverse(&self, a: LatLon, b: LatLon, cell_m: Option<f64>) -> Res<Vec<String>> {
        let (lat, lon, size_km, px) = grid_spec(a, b, cell_m)?;
        self.required_tiles_patch(lat, lon, size_km, px)
    }

    pub fn traverse(&self, start: LatLon, goal: LatLon, t_start: f64, lim: &Limits, cell_m: Option<f64>) -> Res<TraverseResult> {
        if !(lim.speed_mps > 0.0) || !(lim.max_hours > 0.0) || !(lim.max_slope_deg > 0.0) {
            bail!("limits: maxSlopeDeg, speedMps and maxHours must be positive");
        }
        let (clat, clon, size_km, px) = grid_spec(start, goal, cell_m)?;
        let g = self.patch_grid(clat, clon, size_km, px)?;
        let (p, size) = (g.pixel_m, g.size_m);
        let to_cell = |ll: LatLon| -> Res<usize> {
            let v = unit_from_latlon(ll.lat, ll.lon);
            let up = dot(&v, &g.center);
            let (x, y) = (R * dot(&v, &g.e) / up, R * dot(&v, &g.n) / up);
            let (j, i) = (((x + size / 2.0) / p).floor(), ((size / 2.0 - y) / p).floor());
            if i < 0.0 || j < 0.0 || i >= px as f64 || j >= px as f64 {
                bail!("start/goal outside the planning grid");
            }
            Ok(i as usize * px + j as usize)
        };
        let (cs, cg) = (to_cell(start)?, to_cell(goal)?);
        // slope (rad) of the terrain relative to the sphere
        let tan_max = lim.max_slope_deg.to_radians().tan();
        let mut ok = vec![true; px * px];
        let mut slope_r = vec![0f32; px * px];
        for i in 0..px {
            for j in 0..px {
                let (x, y) = g.xy(i, j);
                let (gx, gy) = (g.gx[i * px + j] as f64 + x / R, g.gy[i * px + j] as f64 + y / R);
                let s = gx.hypot(gy);
                slope_r[i * px + j] = s as f32;
                ok[i * px + j] = s <= tan_max;
            }
        }
        ok[cs] = true;
        ok[cg] = true;
        let n_slices = lim.max_hours.ceil() as usize + 2;
        let mut sl = Slices { eng: self, g: &g, t0: t_start, sun: vec![None; n_slices], earth: vec![None; n_slices] };
        let t_limit = t_start + lim.max_hours * 3600.0;
        let cxy = |c: usize| g.xy(c / px, c % px);
        let (gxy, hz) = (cxy(cg), lim.speed_mps);
        let h = |c: usize| {
            let (x, y) = cxy(c);
            ((x - gxy.0).hypot(y - gxy.1)) / hz
        };
        let mut best_t = vec![f64::INFINITY; px * px];
        let mut parent = vec![usize::MAX; px * px];
        let mut closed = vec![false; px * px];
        let mut heap = BinaryHeap::new();
        best_t[cs] = t_start;
        heap.push(Node { f: t_start + h(cs), t: t_start, idx: cs });
        let mut timed_out = false;
        let mut found = false;
        while let Some(Node { t, idx, .. }) = heap.pop() {
            if closed[idx] {
                continue;
            }
            closed[idx] = true;
            if idx == cg {
                found = true;
                break;
            }
            let (i, j) = ((idx / px) as i64, (idx % px) as i64);
            for di in -1i64..=1 {
                for dj in -1i64..=1 {
                    if di == 0 && dj == 0 {
                        continue;
                    }
                    let (ni, nj) = (i + di, j + dj);
                    if ni < 0 || nj < 0 || ni >= px as i64 || nj >= px as i64 {
                        continue;
                    }
                    let nidx = ni as usize * px + nj as usize;
                    if closed[nidx] || !ok[nidx] {
                        continue;
                    }
                    let dist = p * ((di * di + dj * dj) as f64).sqrt();
                    let sr = (slope_r[nidx] as f64 / tan_max).min(1.0);
                    let dt = dist / lim.speed_mps * (1.0 + sr * sr);
                    // earliest departure >= t at which the destination is acceptable
                    let mut depart = t;
                    let mut feasible = true;
                    if lim.require_sun || lim.require_earth {
                        feasible = false;
                        while depart + dt <= t_limit {
                            let a = depart;
                            let b = depart + dt;
                            let good = (!lim.require_sun || (sl.sun_lit(nidx, a)? && sl.sun_lit(nidx, b)?))
                                && (!lim.require_earth || (sl.earth_up(nidx, a)? && sl.earth_up(nidx, b)?));
                            if good {
                                feasible = true;
                                break;
                            }
                            depart = t_start + (((depart - t_start) / SLICE_S).floor() + 1.0) * SLICE_S;
                        }
                    }
                    let arr = depart + dt;
                    if !feasible || arr > t_limit {
                        if arr > t_limit {
                            timed_out = true;
                        }
                        continue;
                    }
                    if arr < best_t[nidx] {
                        best_t[nidx] = arr;
                        parent[nidx] = idx;
                        heap.push(Node { f: arr + h(nidx), t: arr, idx: nidx });
                    }
                }
            }
        }
        let mk = |status: &str| TraverseResult { path: vec![], distance_m: 0.0, duration_s: 0.0, sunlit_frac: 0.0, earth_frac: 0.0, status: status.into(), cell_m: p, px };
        if !found {
            return Ok(mk(if timed_out { "timeout" } else { "no_path" }));
        }
        let mut cells = vec![cg];
        while *cells.last().unwrap() != cs {
            cells.push(parent[*cells.last().unwrap()]);
        }
        cells.reverse();
        let mut dist = 0.0;
        let (mut sun_n, mut earth_n) = (0usize, 0usize);
        let mut pts = Vec::with_capacity(cells.len());
        let mut prev = cxy(cells[0]);
        for &c in &cells {
            let (x, y) = cxy(c);
            dist += (x - prev.0).hypot(y - prev.1);
            prev = (x, y);
            let t = best_t[c];
            if sl.sun_lit(c, t)? {
                sun_n += 1;
            }
            if sl.earth_up(c, t)? {
                earth_n += 1;
            }
            let (lat, lon) = latlon_from_unit(&g.point(x, y));
            pts.push(PathPoint { lat, lon: wrap180(lon), t });
        }
        let n = cells.len() as f64;
        // decimate to at most ~400 points, keeping the end
        if pts.len() > 400 {
            let step = (pts.len() as f64 / 400.0).ceil() as usize;
            let last = pts.len() - 1;
            pts = pts.into_iter().enumerate().filter(|(i, _)| i % step == 0 || *i == last).map(|(_, p)| p).collect();
        }
        let duration = best_t[cg] - t_start;
        Ok(TraverseResult { path: pts, distance_m: dist, duration_s: duration, sunlit_frac: sun_n as f64 / n, earth_frac: earth_n as f64 / n, status: "ok".into(), cell_m: p, px })
    }
}

