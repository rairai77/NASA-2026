//! Grid-wide precompute used by the pipeline: horizons and Sun/Earth bitsets
//! for the polar index grid (parallel with the `parallel` feature).
use crate::bail;
use crate::ephem::Ephemeris;
use crate::error::Res;
use crate::geo::*;
use crate::horizon::{default_max_dist_m, AzTable};
use crate::par::{pchunks2_mut, pchunks_mut};
use crate::terrain::Terrain;
use crate::visibility::{sky, Site};

#[derive(Clone, Debug)]
pub struct GridSpec {
    pub nx: usize,
    pub ny: usize,
    pub x0: f64,
    pub y0: f64,
    pub cell_m: f64,
}

impl GridSpec {
    pub fn cell_latlon(&self, c: usize) -> (f64, f64) {
        let (i, j) = (c / self.nx, c % self.nx);
        south_stereo_inv(self.x0 + (j as f64 + 0.5) * self.cell_m, self.y0 - (i as f64 + 0.5) * self.cell_m)
    }
}

/// Horizons in 0.01 degree i16 units, layout [ny][nx][n_az]; -32768 = invalid cell.
pub fn grid_horizons(t: &Terrain, g: &GridSpec, n_az: usize, height_m: f64, max_lat: f64) -> Vec<i16> {
    let az = AzTable::new(n_az);
    let mut out = vec![i16::MIN; g.nx * g.ny * n_az];
    pchunks_mut(&mut out, n_az, |c, chunk| {
        let (lat, lon) = g.cell_latlon(c);
        if lat > max_lat {
            return;
        }
        let mut hz = vec![0f32; n_az];
        if t.horizon_into(lat, lon, height_m, default_max_dist_m(lat), &az, &mut hz).is_ok() {
            for (o, h) in chunk.iter_mut().zip(&hz) {
                *o = (*h as f64 * 100.0).round().clamp(-32767.0, 32767.0) as i16;
            }
        }
    });
    out
}

pub struct BitsetSpec {
    pub n_az: usize,
    pub t0: f64,
    pub n_steps: usize,
    pub step_s: f64,
    pub height_m: f64,
}

/// Sun-up / Earth-up bitsets, `words` u64 per cell (bit s = step s).
/// `elev_m` (per cell) overrides terrain lookup of the site height.
pub fn grid_bitsets(
    eph: &Ephemeris,
    terrain: Option<&Terrain>,
    elev_m: Option<&[f32]>,
    horizons: &[i16],
    g: &GridSpec,
    s: &BitsetSpec,
) -> Res<(Vec<u64>, Vec<u64>)> {
    let ncells = g.nx * g.ny;
    if horizons.len() != ncells * s.n_az {
        bail!("horizons length {} != ncells*n_az = {}", horizons.len(), ncells * s.n_az);
    }
    if let Some(e) = elev_m {
        if e.len() != ncells {
            bail!("elev_m length {} != ncells {}", e.len(), ncells);
        }
    }
    eph.check_range(s.t0, s.t0 + (s.n_steps.max(1) - 1) as f64 * s.step_s)?;
    let pos: Vec<(V3, V3)> = (0..s.n_steps)
        .map(|k| eph.at(s.t0 + k as f64 * s.step_s).ok_or("ephemeris lookup failed"))
        .collect::<Result<_, _>>()?;
    let words = (s.n_steps + 63) / 64;
    let mut sun = vec![0u64; ncells * words];
    let mut earth = vec![0u64; ncells * words];
    pchunks2_mut(&mut sun, &mut earth, words, |c, sw, ew| {
        let h = &horizons[c * s.n_az..(c + 1) * s.n_az];
        if h[0] == i16::MIN {
            return;
        }
        let hz: Vec<f32> = h.iter().map(|&v| v as f32 * 0.01).collect();
        let (lat, lon) = g.cell_latlon(c);
        let z = match elev_m {
            Some(e) => e[c] as f64,
            None => terrain
                .and_then(|t| t.site_elevation(&unit_from_latlon(nudge_lat(lat), lon)))
                .map_or(0.0, |v| v.0),
        };
        let site = Site::new(lat, lon, R + z + s.height_m);
        for (k, (su, ea)) in pos.iter().enumerate() {
            let sk = sky(&site, su, ea, &hz);
            if sk.sun_up() {
                sw[k / 64] |= 1 << (k % 64);
            }
            if sk.earth_up() {
                ew[k / 64] |= 1 << (k % 64);
            }
        }
    });
    Ok((sun, earth))
}
