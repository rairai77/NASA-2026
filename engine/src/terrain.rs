//! Terrain level stack: manifest parsing, dense tile store, bilinear sampling,
//! level preference chains and dry-run tile planning.
use crate::bail;
use crate::error::Res;
use crate::geo::{R, V3};
use serde::Deserialize;
use std::collections::HashSet;

#[derive(Deserialize)]
struct LevelJson {
    id: String,
    proj: String,
    pixel_m: Option<f64>,
    x0: Option<f64>,
    y0: Option<f64>,
    ppd: Option<f64>,
    lon_min: Option<f64>,
    lat_max: Option<f64>,
    width: usize,
    height: usize,
    tiles_x: usize,
    tiles_y: usize,
    #[serde(default)]
    path: String,
    #[serde(default)]
    missing: Vec<String>,
}

#[derive(Deserialize)]
struct ManifestJson {
    tile_size: usize,
    height_scale: f64,
    nodata: i32,
    levels: Vec<LevelJson>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Stereo,
    Equirect,
}

pub struct Level {
    pub id: String,
    pub kind: Kind,
    /// Nominal pixel size in metres (equirect: at the equator).
    pub pixel_m: f64,
    pub width: usize,
    pub height: usize,
    pub tiles_x: usize,
    pub tiles_y: usize,
    pub path: String,
    x0: f64,
    y0: f64,
    inv_pm: f64,
    ppd: f64,
    lon_min: f64,
    lat_max: f64,
    wrap_x: bool,
    ts: u32,
    mask: usize,
    missing: HashSet<(usize, usize)>,
    tiles: Vec<Option<Box<[i16]>>>,
    pub n_loaded: usize,
}

#[derive(Clone, Copy)]
pub struct Loc {
    ix0: usize,
    iy0: usize,
    ix1: usize,
    iy1: usize,
    wx: f64,
    wy: f64,
}

impl Level {
    /// Pixel location of a unit vector, None if outside the level extent.
    #[inline]
    pub fn locate(&self, p: &V3) -> Option<Loc> {
        let (fx, fy, wrap) = match self.kind {
            Kind::Stereo => {
                if p[2] >= 0.0 {
                    return None;
                }
                let k = 2.0 * R / (1.0 - p[2]);
                let (x, y) = (p[1] * k, p[0] * k);
                ((x - self.x0) * self.inv_pm - 0.5, (self.y0 - y) * self.inv_pm - 0.5, false)
            }
            Kind::Equirect => {
                let lat = p[2].clamp(-1.0, 1.0).asin().to_degrees();
                let lon = p[1].atan2(p[0]).to_degrees();
                let lr = (lon - self.lon_min).rem_euclid(360.0);
                (lr * self.ppd - 0.5, (self.lat_max - lat) * self.ppd - 0.5, self.wrap_x)
            }
        };
        if !(fy >= 0.0 && fy < (self.height - 1) as f64) {
            return None;
        }
        let (ix0, ix1, wx);
        if wrap {
            let f = fx.floor();
            wx = fx - f;
            let i0 = if f < 0.0 { self.width - 1 } else { (f as usize).min(self.width - 1) };
            ix0 = i0;
            ix1 = if i0 + 1 >= self.width { 0 } else { i0 + 1 };
        } else {
            if !(fx >= 0.0 && fx < (self.width - 1) as f64) {
                return None;
            }
            ix0 = fx as usize;
            ix1 = ix0 + 1;
            wx = fx - ix0 as f64;
        }
        let iy0 = fy as usize;
        Some(Loc { ix0, iy0, ix1, iy1: iy0 + 1, wx, wy: fy - iy0 as f64 })
    }

    #[inline]
    fn get(&self, ix: usize, iy: usize) -> Option<i16> {
        let t = self.tiles[(iy >> self.ts) * self.tiles_x + (ix >> self.ts)].as_ref()?;
        Some(t[((iy & self.mask) << self.ts) | (ix & self.mask)])
    }

    #[inline]
    fn bilinear(&self, l: &Loc, nodata: i16) -> Option<f64> {
        let (v00, v10, v01, v11);
        if (l.ix0 & self.mask) != self.mask && (l.iy0 & self.mask) != self.mask {
            // all four neighbours in one tile (the common case)
            let t = self.tiles[(l.iy0 >> self.ts) * self.tiles_x + (l.ix0 >> self.ts)].as_ref()?;
            let o = ((l.iy0 & self.mask) << self.ts) | (l.ix0 & self.mask);
            let row = 1usize << self.ts;
            v00 = t[o];
            v10 = t[o + 1];
            v01 = t[o + row];
            v11 = t[o + row + 1];
        } else {
            v00 = self.get(l.ix0, l.iy0)?;
            v10 = self.get(l.ix1, l.iy0)?;
            v01 = self.get(l.ix0, l.iy1)?;
            v11 = self.get(l.ix1, l.iy1)?;
        }
        if v00 == nodata || v10 == nodata || v01 == nodata || v11 == nodata {
            return None;
        }
        let top = v00 as f64 * (1.0 - l.wx) + v10 as f64 * l.wx;
        let bot = v01 as f64 * (1.0 - l.wx) + v11 as f64 * l.wx;
        Some(top * (1.0 - l.wy) + bot * l.wy)
    }

    pub fn is_missing(&self, tx: usize, ty: usize) -> bool {
        self.missing.contains(&(tx, ty))
    }

    fn tile_keys(&self, l: &Loc) -> [(usize, usize); 4] {
        let t = |ix: usize, iy: usize| (ix >> self.ts, iy >> self.ts);
        [t(l.ix0, l.iy0), t(l.ix1, l.iy0), t(l.ix0, l.iy1), t(l.ix1, l.iy1)]
    }
}

/// Dense set of (level, tx, ty) tiles, used for dry-run planning.
pub struct TileSet {
    flags: Vec<Vec<bool>>,
}

impl TileSet {
    pub fn new(t: &Terrain) -> Self {
        Self { flags: t.levels.iter().map(|l| vec![false; l.tiles_x * l.tiles_y]).collect() }
    }
    #[inline]
    fn insert(&mut self, t: &Terrain, li: usize, tx: usize, ty: usize) {
        self.flags[li][ty * t.levels[li].tiles_x + tx] = true;
    }
    /// Keys `"levelId/ty/tx"`, sorted by level then ty, tx.
    pub fn keys(&self, t: &Terrain) -> Vec<String> {
        let mut out = Vec::new();
        for (li, f) in self.flags.iter().enumerate() {
            let l = &t.levels[li];
            for (k, &b) in f.iter().enumerate() {
                if b {
                    out.push(format!("{}/{}/{}", l.id, k / l.tiles_x, k % l.tiles_x));
                }
            }
        }
        out
    }
}

pub struct Terrain {
    pub tile_size: usize,
    pub scale: f64,
    pub nodata: i16,
    pub levels: Vec<Level>,
    /// Level preference chains (indices into `levels`) by distance band:
    /// [0] d < 10 km, [1] d < 60 km, [2] farther. Each chain is ordered
    /// finest -> coarsest, so fallback always goes to a coarser level.
    pub chains: [Vec<usize>; 3],
}

impl Terrain {
    pub fn from_manifest_json(json: &str) -> Res<Self> {
        let m: ManifestJson = serde_json::from_str(json)?;
        if !m.tile_size.is_power_of_two() {
            bail!("tile_size must be a power of two, got {}", m.tile_size);
        }
        if m.levels.is_empty() {
            bail!("manifest has no levels");
        }
        let ts = m.tile_size.trailing_zeros();
        let mut levels = Vec::new();
        for lj in m.levels {
            let kind = match lj.proj.as_str() {
                "south_stereo" => Kind::Stereo,
                "equirect" => Kind::Equirect,
                p => bail!("level {}: unknown proj '{p}'", lj.id),
            };
            let (pixel_m, ppd) = match kind {
                Kind::Stereo => (lj.pixel_m.ok_or_else(|| format!("level {}: pixel_m missing", lj.id))?, 0.0),
                Kind::Equirect => {
                    let p = lj.ppd.ok_or_else(|| format!("level {}: ppd missing", lj.id))?;
                    (R * std::f64::consts::PI / 180.0 / p, p)
                }
            };
            if lj.tiles_x * m.tile_size < lj.width || lj.tiles_y * m.tile_size < lj.height {
                bail!("level {}: tile grid smaller than raster", lj.id);
            }
            let mut missing = HashSet::new();
            for s in &lj.missing {
                let mut it = s.split(',');
                if let (Some(a), Some(b)) = (it.next(), it.next()) {
                    if let (Ok(tx), Ok(ty)) = (a.trim().parse(), b.trim().parse()) {
                        missing.insert((tx, ty));
                    }
                }
            }
            let lon_min = lj.lon_min.unwrap_or(0.0);
            let wrap_x = kind == Kind::Equirect && (lj.width as f64 / ppd - 360.0).abs() < 1e-6;
            levels.push(Level {
                id: lj.id,
                kind,
                pixel_m,
                width: lj.width,
                height: lj.height,
                tiles_x: lj.tiles_x,
                tiles_y: lj.tiles_y,
                path: lj.path,
                inv_pm: 1.0 / pixel_m,
                x0: lj.x0.unwrap_or(0.0),
                y0: lj.y0.unwrap_or(0.0),
                ppd,
                lon_min,
                lat_max: lj.lat_max.unwrap_or(90.0),
                wrap_x,
                ts,
                mask: m.tile_size - 1,
                missing,
                tiles: (0..lj.tiles_x * lj.tiles_y).map(|_| None).collect(),
                n_loaded: 0,
            });
        }
        let mut t = Terrain {
            tile_size: m.tile_size,
            scale: m.height_scale,
            nodata: m.nodata as i16,
            levels,
            chains: [vec![], vec![], vec![]],
        };
        t.build_chains();
        Ok(t)
    }

    fn build_chains(&mut self) {
        let mut st: Vec<usize> = (0..self.levels.len()).filter(|&i| self.levels[i].kind == Kind::Stereo).collect();
        let mut gl: Vec<usize> = (0..self.levels.len()).filter(|&i| self.levels[i].kind == Kind::Equirect).collect();
        let key = |l: &Level| l.pixel_m;
        st.sort_by(|&a, &b| key(&self.levels[a]).partial_cmp(&key(&self.levels[b])).unwrap());
        gl.sort_by(|&a, &b| key(&self.levels[a]).partial_cmp(&key(&self.levels[b])).unwrap());
        let ns = st.len();
        let mid_s = 1.min(ns.saturating_sub(1));
        let far_s = ns.saturating_sub(1);
        let ng = gl.len();
        let mut c0: Vec<usize> = st.clone();
        c0.extend(&gl);
        let mut c1: Vec<usize> = st[mid_s.min(ns)..].to_vec();
        c1.extend(&gl);
        let mut c2: Vec<usize> = st[far_s.min(ns)..].to_vec();
        if ng > 0 {
            c2.extend(&gl[1.min(ng - 1)..]);
            if ng > 1 {
                c2.push(gl[0]);
            }
        }
        self.chains = [c0, c1, c2];
    }

    pub fn level_index(&self, id: &str) -> Option<usize> {
        self.levels.iter().position(|l| l.id == id)
    }

    /// Finest nominal pixel size across all levels.
    pub fn finest_pixel(&self) -> f64 {
        self.levels.iter().map(|l| l.pixel_m).fold(f64::INFINITY, f64::min)
    }

    /// Add a gunzipped tile (tile_size^2 little-endian i16).
    pub fn add_tile(&mut self, level_id: &str, tx: usize, ty: usize, raw: &[u8]) -> Res<()> {
        let li = self.level_index(level_id).ok_or_else(|| format!("unknown level '{level_id}'"))?;
        let n = self.tile_size * self.tile_size;
        if raw.len() != n * 2 {
            bail!("tile {level_id}/{ty}/{tx}: expected {} bytes, got {}", n * 2, raw.len());
        }
        let v: Box<[i16]> = raw.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        self.add_tile_i16(li, tx, ty, v)
    }

    pub fn add_tile_i16(&mut self, li: usize, tx: usize, ty: usize, v: Box<[i16]>) -> Res<()> {
        let l = &mut self.levels[li];
        if tx >= l.tiles_x || ty >= l.tiles_y {
            bail!("tile {}/{ty}/{tx} out of range", l.id);
        }
        let k = ty * l.tiles_x + tx;
        if l.tiles[k].is_none() {
            l.n_loaded += 1;
        }
        l.tiles[k] = Some(v);
        Ok(())
    }

    pub fn has_tile(&self, level_id: &str, tx: usize, ty: usize) -> bool {
        match self.level_index(level_id) {
            Some(li) => {
                let l = &self.levels[li];
                tx < l.tiles_x && ty < l.tiles_y && l.tiles[ty * l.tiles_x + tx].is_some()
            }
            None => false,
        }
    }

    /// Bilinear height (m) at a unit vector from one level; None if invalid.
    #[inline]
    pub fn sample(&self, li: usize, p: &V3) -> Option<f64> {
        let l = &self.levels[li];
        let loc = l.locate(p)?;
        l.bilinear(&loc, self.nodata).map(|v| v * self.scale)
    }

    /// First valid sample along a preference chain: (height m, level index).
    #[inline]
    pub fn sample_chain(&self, chain: &[usize], p: &V3) -> Option<(f64, usize)> {
        for &li in chain {
            if let Some(h) = self.sample(li, p) {
                return Some((h, li));
            }
        }
        None
    }

    /// Terrain height at a site (finest valid level) and the level used.
    pub fn site_elevation(&self, u: &V3) -> Option<(f64, usize)> {
        self.sample_chain(&self.chains[0], u)
    }

    /// Dry-run probe: would level `li` resolve this point? Records the tiles it
    /// would touch. Uses real data when all four neighbour tiles are loaded
    /// (so nodata falls back exactly as sampling does), otherwise assumes valid
    /// unless the manifest lists a neighbouring tile as missing.
    pub fn probe(&self, li: usize, p: &V3, set: &mut TileSet) -> bool {
        let l = &self.levels[li];
        let Some(loc) = l.locate(p) else { return false };
        let keys = l.tile_keys(&loc);
        let mut all_loaded = true;
        for &(tx, ty) in &keys {
            if l.missing.contains(&(tx, ty)) {
                return false;
            }
            if l.tiles[ty * l.tiles_x + tx].is_none() {
                all_loaded = false;
            }
        }
        if all_loaded && l.bilinear(&loc, self.nodata).is_none() {
            return false;
        }
        for &(tx, ty) in &keys {
            set.insert(self, li, tx, ty);
        }
        true
    }

    /// Probe a chain; returns the level that resolved the point.
    pub fn probe_chain(&self, chain: &[usize], p: &V3, set: &mut TileSet) -> Option<usize> {
        chain.iter().copied().find(|&li| self.probe(li, p, set))
    }

    /// Tiles covering a disc of `radius_m` around a unit vector at one level
    /// (sampled planar grid over the disc plus bilinear neighbours).
    pub fn tiles_for_disc(&self, li: usize, u: &V3, radius_m: f64, set: &mut TileSet) {
        let l = &self.levels[li];
        let tile_m = l.pixel_m * self.tile_size as f64;
        let mut sp = tile_m * 0.5;
        let n_est = (2.0 * radius_m / sp).powi(2);
        if n_est > 4.0e5 {
            sp *= (n_est / 4.0e5).sqrt();
        }
        let (lat, lon) = crate::geo::latlon_from_unit(u);
        let b = crate::geo::enu(crate::geo::nudge_lat(lat), lon);
        let n = (radius_m / sp).ceil() as i64;
        for iy in -n..=n {
            for ix in -n..=n {
                let (e, nn) = (ix as f64 * sp, iy as f64 * sp);
                if e.hypot(nn) > radius_m + sp {
                    continue;
                }
                let d = e.hypot(nn);
                let (s, c) = (d / R).sin_cos();
                let (te, tn) = if d > 0.0 { (e / d, nn / d) } else { (0.0, 0.0) };
                let mut p = [0.0; 3];
                for k in 0..3 {
                    p[k] = c * b.u[k] + s * (te * b.e[k] + tn * b.n[k]);
                }
                if let Some(loc) = l.locate(&p) {
                    for (tx, ty) in l.tile_keys(&loc) {
                        if !l.missing.contains(&(tx, ty)) {
                            set.insert(self, li, tx, ty);
                        }
                    }
                }
            }
        }
    }
}
