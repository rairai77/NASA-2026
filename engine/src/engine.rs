//! Core engine facade: owns ephemeris, terrain and index and exposes every
//! operation of CONTRACTS §7 as plain Rust. Bindings are thin wrappers.
use crate::bail;
use crate::ephem::Ephemeris;
use crate::error::Res;
use crate::geo::*;
use crate::horizon::{default_max_dist_m, HorizonInfo};
use crate::index::Index;
use crate::metrics::{window_metrics, Metrics};
use crate::query::Query;
use crate::rank::*;
use crate::terrain::{TileSet, Terrain};
use crate::visibility::{events, series, sky, Event, Site};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Default)]
pub struct Engine {
    pub ephem: Option<Ephemeris>,
    pub terrain: Option<Terrain>,
    pub index: Option<Index>,
}

pub struct HorizonResult {
    pub n_az: usize,
    pub elev_deg: Vec<f32>,
    pub info: HorizonInfo,
}

pub struct VisResult {
    pub series: crate::visibility::Series,
    pub metrics: Metrics,
    pub events: Vec<Event>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SunEarth {
    pub sun_az: f64,
    pub sun_el: f64,
    pub sun_radius_deg: f64,
    pub earth_az: f64,
    pub earth_el: f64,
    pub earth_radius_deg: f64,
    pub eclipse_frac: f64,
    pub sun_vec_me: V3,
    pub earth_vec_me: V3,
}

#[derive(Serialize, Debug)]
pub struct EllipsePoint {
    pub lat: f64,
    pub lon: f64,
    pub metrics: Metrics,
}

#[derive(Serialize, Debug)]
pub struct Summary {
    pub min: f64,
    pub median: f64,
    pub max: f64,
}

#[derive(Serialize, Debug)]
pub struct EllipseResult {
    pub points: Vec<EllipsePoint>,
    pub summary: BTreeMap<String, Summary>,
}

/// Azimuth bins used for each landing-ellipse sample point (2 degrees).
pub const ELLIPSE_N_AZ: usize = 180;
pub const ELLIPSE_MAX_POINTS: usize = 1000;

impl Engine {
    pub fn new() -> Self {
        Self::default()
    }

    fn eph(&self) -> Res<&Ephemeris> {
        self.ephem.as_ref().ok_or_else(|| "ephemeris not loaded".into())
    }
    fn terr(&self) -> Res<&Terrain> {
        self.terrain.as_ref().ok_or_else(|| "terrain manifest not loaded".into())
    }
    fn idx(&self) -> Res<&Index> {
        self.index.as_ref().ok_or_else(|| "index manifest not loaded".into())
    }

    // ------------------------------------------------------------ loading
    pub fn load_ephemeris(&mut self, meta_json: &str, bytes: &[u8]) -> Res<()> {
        self.ephem = Some(Ephemeris::from_bytes(meta_json, bytes)?);
        Ok(())
    }
    pub fn load_terrain_manifest(&mut self, json: &str) -> Res<()> {
        self.terrain = Some(Terrain::from_manifest_json(json)?);
        Ok(())
    }
    pub fn add_tile(&mut self, level: &str, tx: usize, ty: usize, raw: &[u8]) -> Res<()> {
        match self.terrain.as_mut() {
            Some(t) => t.add_tile(level, tx, ty, raw),
            None => bail!("terrain manifest not loaded"),
        }
    }
    pub fn has_tile(&self, level: &str, tx: usize, ty: usize) -> bool {
        self.terrain.as_ref().map_or(false, |t| t.has_tile(level, tx, ty))
    }
    pub fn load_index_manifest(&mut self, json: &str) -> Res<()> {
        self.index = Some(Index::from_json(json)?);
        Ok(())
    }
    fn idx_mut(&mut self) -> Res<&mut Index> {
        self.index.as_mut().ok_or_else(|| "index manifest not loaded".into())
    }
    pub fn load_index_static(&mut self, raw: &[u8]) -> Res<()> {
        self.idx_mut()?.load_static(raw)
    }
    pub fn add_index_month(&mut self, month: &str, raw: &[u8]) -> Res<()> {
        self.idx_mut()?.add_month(month, raw)
    }
    pub fn add_horizon_band(&mut self, band: usize, raw: &[u8]) -> Res<()> {
        self.idx_mut()?.add_band(band, raw)
    }
    pub fn index_months_needed(&self, t0: f64, t1: f64) -> Res<Vec<String>> {
        self.idx()?.months_needed(t0, t1)
    }

    // ------------------------------------------------------------ tiles
    pub fn required_tiles(&self, lat: f64, lon: f64, max_dist_km: Option<f64>, n_az: usize) -> Res<Vec<String>> {
        let t = self.terr()?;
        let mut set = TileSet::new(t);
        let md = max_dist_km.map(|k| k * 1000.0).unwrap_or_else(|| default_max_dist_m(lat));
        t.plan_horizon(lat, lon, md, n_az.max(4), &mut set);
        Ok(set.keys(t))
    }

    pub fn required_tiles_area(&self, lat: f64, lon: f64, radius_km: f64, level: Option<&str>) -> Res<Vec<String>> {
        let t = self.terr()?;
        let u = unit_from_latlon(nudge_lat(lat), lon);
        let li = match level {
            Some(id) => t.level_index(id).ok_or_else(|| format!("unknown level '{id}'"))?,
            None => {
                // finest level that covers the centre
                let mut order: Vec<usize> = (0..t.levels.len()).collect();
                order.sort_by(|&a, &b| t.levels[a].pixel_m.partial_cmp(&t.levels[b].pixel_m).unwrap());
                order.into_iter().find(|&li| t.levels[li].locate(&u).is_some()).ok_or("point is not covered by any terrain level")?
            }
        };
        let mut set = TileSet::new(t);
        t.tiles_for_disc(li, &u, radius_km * 1000.0, &mut set);
        Ok(set.keys(t))
    }

    pub fn required_tiles_rect(&self, west: f64, south: f64, east: f64, north: f64, w: usize, h: usize) -> Res<Vec<String>> {
        let t = self.terr()?;
        let mut set = TileSet::new(t);
        t.plan_heights(west, south, east, north, w, h, &mut set);
        Ok(set.keys(t))
    }

    pub fn sample_heights(&self, west: f64, south: f64, east: f64, north: f64, w: usize, h: usize) -> Res<Vec<f32>> {
        if w == 0 || h == 0 || w * h > 4_000_000 {
            bail!("bad grid size {w}x{h}");
        }
        Ok(self.terr()?.sample_heights(west, south, east, north, w, h))
    }

    // ------------------------------------------------------------ horizon / visibility
    pub fn horizon(&self, lat: f64, lon: f64, height_m: f64, n_az: usize) -> Res<HorizonResult> {
        let (elev_deg, info) = self.terr()?.horizon(lat, lon, height_m, n_az, None)?;
        Ok(HorizonResult { n_az, elev_deg, info })
    }

    /// Site terrain height if terrain is loaded and covers the site, else 0.
    pub fn site_elev_or_zero(&self, lat: f64, lon: f64) -> f64 {
        self.terrain
            .as_ref()
            .and_then(|t| t.site_elevation(&unit_from_latlon(nudge_lat(lat), lon)))
            .map_or(0.0, |v| v.0)
    }

    pub fn visibility(&self, lat: f64, lon: f64, h: f64, elev_deg: &[f32], t0: f64, t1: f64, step_s: f64) -> Res<VisResult> {
        self.visibility_z(lat, lon, h, self.site_elev_or_zero(lat, lon), elev_deg, t0, t1, step_s)
    }

    pub fn visibility_z(&self, lat: f64, lon: f64, h: f64, z_m: f64, elev_deg: &[f32], t0: f64, t1: f64, step_s: f64) -> Res<VisResult> {
        if elev_deg.len() < 4 {
            bail!("horizon needs at least 4 azimuth bins");
        }
        let site = Site::new(lat, lon, R + z_m + h);
        let s = series(self.eph()?, &site, elev_deg, t0, t1, step_s)?;
        let metrics = window_metrics(&s);
        let events = events(&s);
        Ok(VisResult { series: s, metrics, events })
    }

    pub fn sun_earth_at(&self, lat: f64, lon: f64, t: f64) -> Res<SunEarth> {
        let site = Site::new(lat, lon, R);
        let (sun, earth) = self.eph()?.at(t).ok_or("time outside ephemeris coverage")?;
        let sk = sky(&site, &sun, &earth, &[0.0; 4]);
        Ok(SunEarth {
            sun_az: sk.sun_az,
            sun_el: sk.sun_el,
            sun_radius_deg: sk.sun_r_deg,
            earth_az: sk.earth_az,
            earth_el: sk.earth_el,
            earth_radius_deg: sk.earth_r_deg,
            eclipse_frac: sk.eclipse_frac,
            sun_vec_me: sk.sun_unit,
            earth_vec_me: sk.earth_unit,
        })
    }

    // ------------------------------------------------------------ ranking
    pub fn rank_coarse(&self, q: &Query) -> Res<CoarseResult> {
        let ix = self.idx()?;
        let pq = q.parse(ix.height_m)?;
        rank_coarse(ix, &pq)
    }

    pub fn rank_refine(&self, q: &Query, cands: &[Candidate]) -> Res<RankResult> {
        let ix = self.idx()?;
        let pq = q.parse(ix.height_m)?;
        rank_refine(ix, self.eph()?, &pq, cands)
    }

    pub fn rank_points(&self, q: &Query, pts: &[PointIn]) -> Res<RankResult> {
        let pq = q.parse(2.0)?;
        let res = self.terrain.as_ref().map_or(20.0, |t| t.finest_pixel());
        rank_points(self.eph()?, &pq, pts, res)
    }

    // ------------------------------------------------------------ ellipse
    /// Landing ellipse: `rot_deg` is the azimuth of the semi-major axis,
    /// clockwise from north. Samples a Fibonacci disc of `n` points.
    #[allow(clippy::too_many_arguments)]
    pub fn ellipse(&self, lat: f64, lon: f64, semi_major_m: f64, semi_minor_m: f64, rot_deg: f64, n: usize, h: f64, t0: f64, t1: f64, step_s: f64) -> Res<EllipseResult> {
        if n == 0 || n > ELLIPSE_MAX_POINTS {
            bail!("ellipse: n must be in [1, {ELLIPSE_MAX_POINTS}]");
        }
        let terr = self.terr()?;
        let eph = self.eph()?;
        let (sr, cr) = rot_deg.to_radians().sin_cos();
        let golden = std::f64::consts::PI * (3.0 - 5f64.sqrt());
        let pts: Vec<(f64, f64)> = (0..n)
            .map(|i| {
                let r = ((i as f64 + 0.5) / n as f64).sqrt();
                let (sa, ca) = (i as f64 * golden).sin_cos();
                let (a, b) = (r * ca * semi_major_m, r * sa * semi_minor_m);
                // major axis along azimuth rot (E,N)=(sr,cr); minor axis 90 deg clockwise (cr,-sr)
                let east = a * sr + b * cr;
                let north = a * cr - b * sr;
                let d = east.hypot(north);
                if d < 1e-6 {
                    (lat, lon)
                } else {
                    destination(lat, lon, east.atan2(north).to_degrees(), d)
                }
            })
            .collect();
        let az = crate::horizon::AzTable::new(ELLIPSE_N_AZ);
        let rows: Vec<Res<EllipsePoint>> = crate::par::pmap(&pts, |&(la, lo)| {
            let mut hz = vec![0f32; ELLIPSE_N_AZ];
            let info = terr.horizon_into(la, lo, h, default_max_dist_m(la), &az, &mut hz)?;
            let site = Site::new(la, lo, R + info.site_elev_m + h);
            let s = series(eph, &site, &hz, t0, t1, step_s)?;
            Ok(EllipsePoint { lat: la, lon: wrap180(lo), metrics: window_metrics(&s) })
        });
        let mut points = Vec::with_capacity(n);
        for r in rows {
            points.push(r?);
        }
        let mut summary = BTreeMap::new();
        let keys: Vec<String> = points[0].metrics.keys().cloned().collect();
        for k in keys {
            let mut v: Vec<f64> = points.iter().filter_map(|p| p.metrics.get(&k).copied()).collect();
            if v.is_empty() {
                continue;
            }
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let m = v.len();
            let median = if m % 2 == 1 { v[m / 2] } else { 0.5 * (v[m / 2 - 1] + v[m / 2]) };
            summary.insert(k, Summary { min: v[0], median, max: v[m - 1] });
        }
        Ok(EllipseResult { points, summary })
    }
}
