//! Global equirect grid precompute (coarse global region search): horizons and
//! Sun/Earth bitsets with the same layout as the polar index.
use crate::bail;
use crate::ephem::Ephemeris;
use crate::error::Res;
use crate::geo::*;
use crate::grid::BitsetSpec;
use crate::horizon::AzTable;
use crate::par::{pchunks2_mut, pchunks_mut};
use crate::terrain::Terrain;
use crate::visibility::{sky, Site};

#[derive(Clone, Debug)]
pub struct GlobalGrid {
    pub nx: usize,
    pub ny: usize,
    pub ppd: f64,
    pub lon_min: f64,
    pub lat_max: f64,
}

impl GlobalGrid {
    /// Whole-Moon grid with `ppd` cells per degree, lon from -180, lat from 90.
    pub fn whole_moon(ppd: f64) -> Self {
        Self { nx: (360.0 * ppd).round() as usize, ny: (180.0 * ppd).round() as usize, ppd, lon_min: -180.0, lat_max: 90.0 }
    }
    pub fn cell_latlon(&self, c: usize) -> (f64, f64) {
        let (i, j) = (c / self.nx, c % self.nx);
        (self.lat_max - (i as f64 + 0.5) / self.ppd, self.lon_min + (j as f64 + 0.5) / self.ppd)
    }
}

/// Horizons in 0.01 degree i16 units, layout [ny][nx][n_az]; -32768 where there is no terrain.
pub fn global_grid_horizons(t: &Terrain, g: &GlobalGrid, n_az: usize, height_m: f64, max_dist_m: f64) -> Vec<i16> {
    let az = AzTable::new(n_az);
    let mut out = vec![i16::MIN; g.nx * g.ny * n_az];
    pchunks_mut(&mut out, n_az, |c, chunk| {
        let (lat, lon) = g.cell_latlon(c);
        let mut hz = vec![0f32; n_az];
        if t.horizon_into(lat, lon, height_m, max_dist_m, &az, &mut hz).is_ok() {
            for (o, h) in chunk.iter_mut().zip(&hz) {
                *o = (*h as f64 * 100.0).round().clamp(-32767.0, 32767.0) as i16;
            }
        }
    });
    out
}

/// Sun-up / Earth-up bitsets for the global grid (`words` u64 per cell).
pub fn global_grid_bitsets(
    eph: &Ephemeris,
    terrain: Option<&Terrain>,
    elev_m: Option<&[f32]>,
    horizons: &[i16],
    g: &GlobalGrid,
    s: &BitsetSpec,
) -> Res<(Vec<u64>, Vec<u64>)> {
    let ncells = g.nx * g.ny;
    if horizons.len() != ncells * s.n_az {
        bail!("horizons length {} != ncells*n_az = {}", horizons.len(), ncells * s.n_az);
    }
    if elev_m.map_or(false, |e| e.len() != ncells) {
        bail!("elev_m length must equal ncells");
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
            None => terrain.and_then(|t| t.site_elevation(&unit_from_latlon(nudge_lat(lat), lon))).map_or(0.0, |v| v.0),
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
