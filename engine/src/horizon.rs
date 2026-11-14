//! Horizon march: per azimuth, max elevation angle along a great circle.
use crate::bail;
use crate::error::Res;
use crate::geo::{enu, nudge_lat, unit_from_latlon, R};
use crate::terrain::{TileSet, Terrain};

/// Precomputed sin/cos of the azimuth grid (shareable across many sites).
pub struct AzTable {
    pub n: usize,
    pub sin: Vec<f64>,
    pub cos: Vec<f64>,
}

impl AzTable {
    pub fn new(n: usize) -> Self {
        let mut sin = Vec::with_capacity(n);
        let mut cos = Vec::with_capacity(n);
        for k in 0..n {
            let (s, c) = (k as f64 * 2.0 * std::f64::consts::PI / n as f64).sin_cos();
            sin.push(s);
            cos.push(c);
        }
        Self { n, sin, cos }
    }
}

#[derive(Clone, Debug)]
pub struct HorizonInfo {
    pub resolution_m: f64,
    pub max_dist_km: f64,
    pub site_elev_m: f64,
    pub missing_samples: usize,
}

pub fn default_max_dist_m(lat_deg: f64) -> f64 {
    if lat_deg.abs() > 75.0 {
        300_000.0
    } else {
        150_000.0
    }
}

#[inline]
pub(crate) fn chain_for(t: &Terrain, d: f64) -> &[usize] {
    if d < 10_000.0 {
        &t.chains[0]
    } else if d < 60_000.0 {
        &t.chains[1]
    } else {
        &t.chains[2]
    }
}

/// Linear interpolation of an azimuth-binned horizon (degrees), wrapping.
#[inline]
pub fn interp_horizon(h: &[f32], az_deg: f64) -> f64 {
    let n = h.len();
    let f = az_deg.rem_euclid(360.0) / 360.0 * n as f64;
    let i0 = (f.floor() as usize).min(n - 1);
    let w = f - i0 as f64;
    let i1 = if i0 + 1 >= n { 0 } else { i0 + 1 };
    h[i0] as f64 * (1.0 - w) + h[i1] as f64 * w
}

/// Per-site constants shared by all azimuth marches.
pub struct SitePrep {
    u: [f64; 3],
    e: [f64; 3],
    n: [f64; 3],
    d0: f64,
    ro: f64,
    limb_deg: f64,
    li_site: usize,
    pub z_site: f64,
}

impl Terrain {
    pub fn prepare_site(&self, lat_deg: f64, lon_deg: f64, h: f64) -> Res<SitePrep> {
        let lat = nudge_lat(lat_deg);
        let u = unit_from_latlon(lat, lon_deg);
        let b = enu(lat, lon_deg);
        let Some((z_site, li_site)) = self.site_elevation(&u) else {
            bail!("no terrain data at site ({lat_deg:.4}, {lon_deg:.4}): tiles not loaded or outside coverage");
        };
        let ro = R + z_site + h;
        Ok(SitePrep {
            u,
            e: b.e,
            n: b.n,
            d0: self.levels[li_site].pixel_m,
            ro,
            limb_deg: -(R / ro).acos().to_degrees(),
            li_site,
            z_site,
        })
    }

    /// March one azimuth: (elevation deg, levels-used bitmask, missing samples).
    pub fn march_az(&self, p: &SitePrep, sa: f64, ca: f64, max_dist_m: f64) -> (f32, u64, usize) {
        let t = [
            ca * p.n[0] + sa * p.e[0],
            ca * p.n[1] + sa * p.e[1],
            ca * p.n[2] + sa * p.e[2],
        ];
        let (u, ro) = (&p.u, p.ro);
        let mut best = f64::NEG_INFINITY; // tangent of elevation
        let mut used = 0u64;
        let mut missing = 0usize;
        let mut d = p.d0;
        let (mut s, mut c) = (d / R).sin_cos();
        while d <= max_dist_m {
            let q = [c * u[0] + s * t[0], c * u[1] + s * t[1], c * u[2] + s * t[2]];
            let chain = chain_for(self, d);
            let step;
            match self.sample_chain(chain, &q) {
                Some((z, li)) => {
                    used |= 1 << li;
                    let rt = R + z;
                    // el = atan2(rt c - ro, rt s); monotone in the ratio since s > 0
                    let tn = (rt * c - ro) / (rt * s);
                    if tn > best {
                        best = tn;
                    }
                    step = self.levels[li].pixel_m;
                }
                None => {
                    missing += 1;
                    step = self.levels[chain[0]].pixel_m;
                }
            }
            let dd = step.max(0.005 * d);
            d += dd;
            // advance (sin, cos) by dl = dd / R with a series for the small angle
            let dl = dd / R;
            let dl2 = dl * dl;
            let sd = dl * (1.0 - dl2 / 6.0);
            let cd = 1.0 - dl2 * 0.5 * (1.0 - dl2 / 12.0);
            let (s2, c2) = (s * cd + c * sd, c * cd - s * sd);
            s = s2;
            c = c2;
        }
        let el = if best.is_finite() { best.atan().to_degrees() } else { p.limb_deg };
        (el as f32, used, missing)
    }

    fn finish_info(&self, p: &SitePrep, used: u64, missing: usize, max_dist_m: f64) -> HorizonInfo {
        let used = used | (1 << p.li_site);
        let mut res = f64::INFINITY;
        for (i, l) in self.levels.iter().enumerate() {
            if used >> i & 1 == 1 {
                res = res.min(l.pixel_m);
            }
        }
        HorizonInfo { resolution_m: res, max_dist_km: max_dist_m / 1000.0, site_elev_m: p.z_site, missing_samples: missing }
    }

    /// Compute the horizon (degrees) for `az.n` azimuths into `out` (sequential;
    /// safe to call from inside a parallel loop over sites).
    pub fn horizon_into(&self, lat_deg: f64, lon_deg: f64, h: f64, max_dist_m: f64, az: &AzTable, out: &mut [f32]) -> Res<HorizonInfo> {
        debug_assert_eq!(out.len(), az.n);
        let p = self.prepare_site(lat_deg, lon_deg, h)?;
        let (mut used, mut missing) = (0u64, 0usize);
        for k in 0..az.n {
            let (e, u, m) = self.march_az(&p, az.sin[k], az.cos[k], max_dist_m);
            out[k] = e;
            used |= u;
            missing += m;
        }
        Ok(self.finish_info(&p, used, missing, max_dist_m))
    }

    /// Single-site horizon; azimuths are split across threads with the
    /// `parallel` feature.
    pub fn horizon_par(&self, lat_deg: f64, lon_deg: f64, h: f64, max_dist_m: f64, n_az: usize) -> Res<(Vec<f32>, HorizonInfo)> {
        use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering::Relaxed};
        let p = self.prepare_site(lat_deg, lon_deg, h)?;
        let az = AzTable::new(n_az);
        let mut out = vec![0f32; n_az];
        let (used, missing) = (AtomicU64::new(0), AtomicUsize::new(0));
        crate::par::pchunks_mut(&mut out, 8, |ci, chunk| {
            let (mut u, mut m) = (0u64, 0usize);
            for (j, o) in chunk.iter_mut().enumerate() {
                let k = ci * 8 + j;
                let (e, uu, mm) = self.march_az(&p, az.sin[k], az.cos[k], max_dist_m);
                *o = e;
                u |= uu;
                m += mm;
            }
            used.fetch_or(u, Relaxed);
            missing.fetch_add(m, Relaxed);
        });
        let info = self.finish_info(&p, used.load(Relaxed), missing.load(Relaxed), max_dist_m);
        Ok((out, info))
    }

    pub fn horizon(&self, lat_deg: f64, lon_deg: f64, h: f64, n_az: usize, max_dist_m: Option<f64>) -> Res<(Vec<f32>, HorizonInfo)> {
        if n_az < 4 || n_az > 14400 {
            bail!("n_az must be in [4, 14400]");
        }
        let md = max_dist_m.unwrap_or_else(|| default_max_dist_m(lat_deg));
        self.horizon_par(lat_deg, lon_deg, h, md, n_az)
    }

    /// Dry run of `horizon_into`: records the tiles the march would touch.
    pub fn plan_horizon(&self, lat_deg: f64, lon_deg: f64, max_dist_m: f64, n_az: usize, set: &mut TileSet) {
        let lat = nudge_lat(lat_deg);
        let u = unit_from_latlon(lat, lon_deg);
        let b = enu(lat, lon_deg);
        let Some(li_site) = self.probe_chain(&self.chains[0], &u, set) else { return };
        let d0 = self.levels[li_site].pixel_m;
        let az = AzTable::new(n_az);
        for k in 0..n_az {
            let (sa, ca) = (az.sin[k], az.cos[k]);
            let t = [
                ca * b.n[0] + sa * b.e[0],
                ca * b.n[1] + sa * b.e[1],
                ca * b.n[2] + sa * b.e[2],
            ];
            let mut d = d0;
            while d <= max_dist_m {
                let (s, c) = (d / R).sin_cos();
                let p = [c * u[0] + s * t[0], c * u[1] + s * t[1], c * u[2] + s * t[2]];
                let chain = chain_for(self, d);
                let step = match self.probe_chain(chain, &p, set) {
                    Some(li) => self.levels[li].pixel_m,
                    None => self.levels[chain[0]].pixel_m,
                };
                d += step.max(0.005 * d);
            }
        }
    }
}
