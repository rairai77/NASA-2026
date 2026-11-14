//! Terrain-true shadow patches: gnomonic ENU height grid, line-of-sight sweep
//! along the Sun azimuth with a monotone convex-hull stack, far-field seeds.
use crate::bail;
use crate::error::Res;
use crate::geo::*;
use crate::horizon::chain_for;
use crate::par::pchunks_mut;
use crate::terrain::{Kind, TileSet, Terrain};
use crate::visibility::sun_fraction;

/// Cached height grid for one patch (independent of time).
pub struct PatchGrid {
    pub lat: f64,
    pub lon: f64,
    pub size_km: f64,
    pub px: usize,
    pub size_m: f64,
    pub pixel_m: f64,
    pub center: V3,
    pub e: V3,
    pub n: V3,
    /// Exact "up" coordinate in the centre ENU frame (m): (R+z)/sqrt(1+rho^2/R^2) - R.
    pub up: Vec<f32>,
    /// d(up)/d(east), d(up)/d(north)
    pub gx: Vec<f32>,
    pub gy: Vec<f32>,
}

pub struct SunGeom {
    pub az_deg: f64,
    pub el_deg: f64,
    pub r_deg: f64,
    pub eclipse: f64,
}

impl PatchGrid {
    pub fn point(&self, x: f64, y: f64) -> V3 {
        let mut p = [0.0; 3];
        for k in 0..3 {
            p[k] = self.center[k] + x / R * self.e[k] + y / R * self.n[k];
        }
        let l = norm(&p);
        scale(&p, 1.0 / l)
    }

    #[inline]
    pub fn xy(&self, i: usize, j: usize) -> (f64, f64) {
        (-self.size_m / 2.0 + (j as f64 + 0.5) * self.pixel_m, self.size_m / 2.0 - (i as f64 + 0.5) * self.pixel_m)
    }

    pub fn build(t: &Terrain, lat: f64, lon: f64, size_km: f64, px: usize) -> Res<Self> {
        if px < 8 || px > 4096 || !(size_km > 0.0) {
            bail!("bad patch: sizeKm={size_km} px={px}");
        }
        let lat_n = nudge_lat(lat);
        let b = enu(lat_n, lon);
        let size_m = size_km * 1000.0;
        let pixel_m = size_m / px as f64;
        let mut g = PatchGrid {
            lat, lon, size_km, px, size_m, pixel_m,
            center: b.u, e: b.e, n: b.n,
            up: vec![0.0; px * px], gx: vec![0.0; px * px], gy: vec![0.0; px * px],
        };
        let (cf, ff) = t.levels_by_pixel();
        let mut any = false;
        for i in 0..px {
            for j in 0..px {
                let (x, y) = g.xy(i, j);
                let p = g.point(x, y);
                let z = match t.height_for_spacing(&p, pixel_m, &cf, &ff) {
                    Some(z) => {
                        any = true;
                        z
                    }
                    None => 0.0,
                };
                g.up[i * px + j] = ((R + z) / (1.0 + (x * x + y * y) / (R * R)).sqrt() - R) as f32;
            }
        }
        if !any {
            bail!("no terrain data in patch: tiles not loaded or outside coverage");
        }
        for i in 0..px {
            for j in 0..px {
                let (j0, j1) = (j.saturating_sub(1), (j + 1).min(px - 1));
                let (i0, i1) = (i.saturating_sub(1), (i + 1).min(px - 1));
                g.gx[i * px + j] = ((g.up[i * px + j1] - g.up[i * px + j0]) as f64 / ((j1 - j0) as f64 * pixel_m)) as f32;
                g.gy[i * px + j] = ((g.up[i0 * px + j] - g.up[i1 * px + j]) as f64 / ((i1 - i0) as f64 * pixel_m)) as f32;
            }
        }
        Ok(g)
    }

    #[inline]
    fn bilinear_up(&self, gxf: f64, gyf: f64) -> f32 {
        let (x0, y0) = (gxf.floor(), gyf.floor());
        let (wx, wy) = ((gxf - x0) as f32, (gyf - y0) as f32);
        let (ix, iy) = (x0 as usize, y0 as usize);
        let px = self.px;
        let a = self.up[iy * px + ix];
        let b = self.up[iy * px + ix + 1];
        let c = self.up[(iy + 1) * px + ix];
        let d = self.up[(iy + 1) * px + ix + 1];
        (a * (1.0 - wx) + b * wx) * (1.0 - wy) + (c * (1.0 - wx) + d * wx) * wy
    }
}

/// Tiles the grid build will read (dry run on a strided subset plus the border).
pub fn plan_patch(t: &Terrain, lat: f64, lon: f64, size_km: f64, px: usize, set: &mut TileSet) {
    let lat_n = nudge_lat(lat);
    let b = enu(lat_n, lon);
    let size_m = size_km * 1000.0;
    let pixel_m = size_m / px as f64;
    let g = PatchGrid { lat, lon, size_km, px, size_m, pixel_m, center: b.u, e: b.e, n: b.n, up: vec![], gx: vec![], gy: vec![] };
    let (cf, ff) = t.levels_by_pixel();
    let mut probe = |i: usize, j: usize| {
        let (x, y) = g.xy(i, j);
        let p = g.point(x, y);
        let _ = cf.iter().filter(|&&li| t.levels[li].pixel_m <= pixel_m).any(|&li| t.probe(li, &p, set)) || ff.iter().any(|&li| t.probe(li, &p, set));
    };
    let stride = 16;
    let mut idx: Vec<usize> = (0..px).step_by(stride).collect();
    idx.push(px - 1);
    for &i in &idx {
        for &j in &idx {
            probe(i, j);
        }
    }
    // Equirect tiles converge at the poles (width ~ tile_width_rad * d), so a strided probe can
    // skip whole tiles there. Probe every pixel within the radius where tiles are narrower
    // than the stride, for equirect levels this patch can actually use.
    let d_max = t
        .levels
        .iter()
        .filter(|l| l.kind == Kind::Equirect && l.pixel_m <= pixel_m)
        .map(|l| stride as f64 * pixel_m / (t.tile_size as f64 * l.pixel_m / R))
        .fold(0.0, f64::max);
    if d_max > 0.0 {
        for pole in [[0.0, 0.0, -1.0], [0.0, 0.0, 1.0]] {
            let cz = dot(&pole, &g.center);
            if cz <= 1e-6 {
                continue;
            }
            let (x, y) = (R * dot(&pole, &g.e) / cz, R * dot(&pole, &g.n) / cz);
            let (pj, pi) = ((x + size_m / 2.0) / pixel_m - 0.5, (size_m / 2.0 - y) / pixel_m - 0.5);
            let r = d_max / pixel_m * 1.1 + 2.0;
            let last = (px - 1) as f64;
            if pi + r < 0.0 || pj + r < 0.0 || pi - r > last || pj - r > last {
                continue;
            }
            let lo = |c: f64| (c - r).floor().max(0.0) as usize;
            let hi = |c: f64| (c + r).ceil().min(last).max(0.0) as usize;
            for i in lo(pi)..=hi(pi) {
                for j in lo(pj)..=hi(pj) {
                    probe(i, j);
                }
            }
        }
    }
    for k in 0..px {
        probe(0, k);
        probe(px - 1, k);
        probe(k, 0);
        probe(k, px - 1);
    }
}

/// Far-field seed: highest-slope terrain point beyond boundary point B, as seen
/// from B in the centre frame. Returns (s, up) of that point.
fn far_seed(t: &Terrain, g: &PatchGrid, bx: f64, by: f64, ub: f64, sun: &V3, sa: f64, ca: f64) -> Option<(f32, f32)> {
    let pb = g.point(bx, by);
    let (lat, lon) = latlon_from_unit(&pb);
    let eb = enu(nudge_lat(lat), lon);
    let az = dot(sun, &eb.e).atan2(dot(sun, &eb.n));
    let (sz, cz) = az.sin_cos();
    let tv = [cz * eb.n[0] + sz * eb.e[0], cz * eb.n[1] + sz * eb.e[1], cz * eb.n[2] + sz * eb.e[2]];
    let max_d = crate::horizon::default_max_dist_m(lat);
    let s_b = bx * sa + by * ca;
    let mut best = f64::NEG_INFINITY;
    let mut out = None;
    let mut d = g.pixel_m;
    while d <= max_d {
        let (s, c) = (d / R).sin_cos();
        let q = [c * pb[0] + s * tv[0], c * pb[1] + s * tv[1], c * pb[2] + s * tv[2]];
        let chain = chain_for(t, d);
        let step = match t.sample_chain(chain, &q) {
            Some((z, li)) => {
                let r3 = scale(&q, R + z);
                let st = dot(&r3, &g.e) * sa + dot(&r3, &g.n) * ca;
                let up = dot(&r3, &g.center) - R;
                let ds = st - s_b;
                if ds > g.pixel_m * 0.5 {
                    let slope = (up - ub) / ds;
                    if slope > best {
                        best = slope;
                        out = Some((st as f32, up as f32));
                    }
                }
                t.levels[li].pixel_m
            }
            None => t.levels[chain[0]].pixel_m,
        };
        d += step.max(0.005 * d);
    }
    out
}

/// Visible Sun fraction (x255) and Lambert shading (x255), px*px*2 bytes, row 0 = north.
pub fn shadow(t: &Terrain, g: &PatchGrid, sun: &V3, sg: &SunGeom) -> Vec<u8> {
    let px = g.px;
    let p = g.pixel_m;
    let (sa, ca) = sg.az_deg.to_radians().sin_cos();
    let el = sg.el_deg.to_radians();
    let rr = sg.r_deg.to_radians();
    let half = g.size_m / 2.0 - p * 0.5; // pixel-centre range
    let ext = g.size_m * (sa.abs() + ca.abs());
    let nrot = (ext / p).ceil() as usize + 3;
    let mid = (nrot as f64 - 1.0) / 2.0;
    // sample position of rot raster cell (k = perpendicular, m = along Sun)
    let pos = |k: usize, m: usize| -> (f64, f64) {
        let (s, w) = ((m as f64 - mid) * p, (k as f64 - mid) * p);
        (s * sa + w * ca, s * ca - w * sa)
    };
    let inside = |x: f64, y: f64| x.abs() <= half && y.abs() <= half;
    let grid_xy = |x: f64, y: f64| ((x + g.size_m / 2.0) / p - 0.5, (g.size_m / 2.0 - y) / p - 0.5);

    // pass A: far-field seeds on sparse rows (entry = most sun-ward sample inside the patch)
    let n_seed = 48usize.min(nrot);
    let stride = (nrot / n_seed).max(1);
    let mut seeds: Vec<(usize, (f32, f32), f32)> = Vec::new(); // (row, far point, s_entry)
    let mut k = 0;
    while k < nrot {
        for m in (0..nrot).rev() {
            let (x, y) = pos(k, m);
            if inside(x, y) {
                let (gxf, gyf) = grid_xy(x, y);
                let ub = g.bilinear_up(gxf.clamp(0.0, (px - 1) as f64 - 1e-6), gyf.clamp(0.0, (px - 1) as f64 - 1e-6)) as f64;
                if let Some(fs) = far_seed(t, g, x, y, ub, sun, sa, ca) {
                    seeds.push((k, fs, ((m as f64 - mid) * p) as f32));
                }
                break;
            }
        }
        k += stride;
    }
    let seed_for = |k: usize| -> Option<(f32, f32)> {
        if seeds.is_empty() {
            return None;
        }
        let pos_i = seeds.partition_point(|s| s.0 <= k);
        let lo = if pos_i > 0 { Some(&seeds[pos_i - 1]) } else { None };
        let hi = seeds.get(pos_i);
        match (lo, hi) {
            (Some(a), Some(b)) if b.0 > a.0 => {
                let w = (k - a.0) as f32 / (b.0 - a.0) as f32;
                Some((a.1 .0 * (1.0 - w) + b.1 .0 * w, a.1 .1 * (1.0 - w) + b.1 .1 * w))
            }
            (Some(a), _) => Some(a.1),
            (None, Some(b)) => Some(b.1),
            _ => None,
        }
    };

    // pass B: per line sample + monotone hull sweep -> max slope toward the Sun
    let mut slope = vec![f32::NAN; nrot * nrot];
    pchunks_mut(&mut slope, nrot, |k, row| {
        let seed = seed_for(k);
        let mut stack: Vec<(f32, f32)> = Vec::with_capacity(nrot + 1);
        let mut first = true;
        for m in (0..nrot).rev() {
            let (x, y) = pos(k, m);
            if !inside(x, y) {
                continue;
            }
            if first {
                first = false;
                if let Some(sd) = seed {
                    stack.push(sd);
                }
            }
            let (gxf, gyf) = grid_xy(x, y);
            let sq = ((m as f64 - mid) * p) as f32;
            let uq = g.bilinear_up(gxf.clamp(0.0, (px - 1) as f64 - 1e-6), gyf.clamp(0.0, (px - 1) as f64 - 1e-6));
            let sl = |a: (f32, f32)| (a.1 - uq) / (a.0 - sq);
            while stack.len() >= 2 && sl(stack[stack.len() - 1]) <= sl(stack[stack.len() - 2]) {
                stack.pop();
            }
            row[m] = match stack.last() {
                Some(&top) => sl(top),
                None => f32::NEG_INFINITY,
            };
            stack.push((sq, uq));
        }
    });

    // thresholds in slope space
    let t_lo = (el - rr).min(1.5707).tan() as f32; // fully lit at or below
    let t_hi = (el + rr).min(1.5707).tan() as f32; // fully shadowed at or above
    let (sx, sy, sz) = (el.cos() * sa, el.cos() * ca, el.sin());
    let vis_scale = 1.0 - sg.eclipse;
    let mut out = vec![0u8; px * px * 2];
    let get = |k: usize, m: usize| slope[k * nrot + m];
    for i in 0..px {
        for j in 0..px {
            let (x, y) = g.xy(i, j);
            let (s, w) = (x * sa + y * ca, x * ca - y * sa);
            let (fm, fk) = (s / p + mid, w / p + mid);
            let (m0, k0) = (fm.floor() as usize, fk.floor() as usize);
            let (wm, wk) = ((fm - m0 as f64) as f32, (fk - k0 as f64) as f32);
            // weighted bilinear over valid (non-NaN) neighbours; -inf counts as very low slope
            let mut acc = 0.0f32;
            let mut wsum = 0.0f32;
            for (dk, dm, wt) in [(0, 0, (1.0 - wk) * (1.0 - wm)), (0, 1, (1.0 - wk) * wm), (1, 0, wk * (1.0 - wm)), (1, 1, wk * wm)] {
                let v = get(k0 + dk, m0 + dm);
                if !v.is_nan() && wt > 0.0 {
                    acc += wt * v.max(-1.0e3);
                    wsum += wt;
                }
            }
            let sl = if wsum > 0.0 { acc / wsum } else { -1.0e3 };
            let frac = if sl >= t_hi {
                0.0
            } else if sl <= t_lo {
                1.0
            } else {
                sun_fraction(el - (sl as f64).atan(), rr)
            };
            let o = (i * px + j) * 2;
            out[o] = ((frac * vis_scale).clamp(0.0, 1.0) * 255.0).round() as u8;
            let (gx, gy) = (g.gx[i * px + j] as f64, g.gy[i * px + j] as f64);
            let lam = ((-gx * sx - gy * sy + sz) / (1.0 + gx * gx + gy * gy).sqrt()).max(0.0);
            out[o + 1] = (lam.min(1.0) * 255.0).round() as u8;
        }
    }
    out
}
