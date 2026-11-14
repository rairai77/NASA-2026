//! Region index: grid geometry, static columns, month bitsets, horizon bands.
use crate::bail;
use crate::error::Res;
use crate::geo::*;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize, Clone, Debug)]
pub struct GridJson {
    pub cell_m: f64,
    pub x0: f64,
    pub y0: f64,
    pub nx: usize,
    pub ny: usize,
    pub max_lat: f64,
}
#[derive(Deserialize, Clone, Debug)]
struct StaticJson {
    columns: Vec<String>,
}
#[derive(Deserialize, Clone, Debug)]
struct HorizonsJson {
    rows_per_band: usize,
    #[serde(default = "default_scale")]
    scale_deg: f64,
}
fn default_scale() -> f64 {
    0.01
}
#[derive(Deserialize, Clone, Debug)]
pub struct MonthJson {
    pub month: String,
    pub t0_unix: f64,
    pub n_steps: usize,
    pub words: usize,
}
#[derive(Deserialize)]
struct IndexJson {
    grid: GridJson,
    height_m: f64,
    n_az: usize,
    step_s: f64,
    #[serde(rename = "static")]
    static_: StaticJson,
    horizons: HorizonsJson,
    months: Vec<MonthJson>,
}

pub struct Index {
    pub grid: GridJson,
    pub height_m: f64,
    pub n_az: usize,
    pub step_s: f64,
    pub rows_per_band: usize,
    pub scale_deg: f64,
    pub static_cols: Vec<String>,
    pub months: Vec<MonthJson>,
    pub lat: Vec<f64>,
    pub lon: Vec<f64>,
    pub valid: Vec<bool>,
    pub statics: HashMap<String, Vec<f32>>,
    pub month_data: HashMap<String, Vec<u64>>,
    pub bands: HashMap<usize, Vec<i16>>,
}

impl Index {
    pub fn from_json(json: &str) -> Res<Self> {
        let m: IndexJson = serde_json::from_str(json)?;
        let g = m.grid;
        let n = g.nx * g.ny;
        let (mut lat, mut lon, mut valid) = (vec![f64::NAN; n], vec![f64::NAN; n], vec![false; n]);
        for i in 0..g.ny {
            for j in 0..g.nx {
                let (x, y) = Self::cell_xy_of(&g, i, j);
                let (la, lo) = south_stereo_inv(x, y);
                let c = i * g.nx + j;
                lat[c] = la;
                lon[c] = lo;
                valid[c] = la <= g.max_lat;
            }
        }
        Ok(Index {
            grid: g,
            height_m: m.height_m,
            n_az: m.n_az,
            step_s: m.step_s,
            rows_per_band: m.horizons.rows_per_band,
            scale_deg: m.horizons.scale_deg,
            static_cols: m.static_.columns,
            months: m.months,
            lat,
            lon,
            valid,
            statics: HashMap::new(),
            month_data: HashMap::new(),
            bands: HashMap::new(),
        })
    }

    fn cell_xy_of(g: &GridJson, i: usize, j: usize) -> (f64, f64) {
        (g.x0 + (j as f64 + 0.5) * g.cell_m, g.y0 - (i as f64 + 0.5) * g.cell_m)
    }

    pub fn ncells(&self) -> usize {
        self.grid.nx * self.grid.ny
    }

    pub fn cell_unit(&self, c: usize) -> V3 {
        unit_from_latlon(self.lat[c], self.lon[c])
    }

    pub fn load_static(&mut self, raw: &[u8]) -> Res<()> {
        let n = self.ncells();
        let nc = self.static_cols.len();
        if raw.len() != nc * n * 4 {
            bail!("index static: expected {} bytes ({} cols x {} cells), got {}", nc * n * 4, nc, n, raw.len());
        }
        for (k, name) in self.static_cols.clone().iter().enumerate() {
            let col: Vec<f32> = raw[k * n * 4..(k + 1) * n * 4]
                .chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            self.statics.insert(name.clone(), col);
        }
        Ok(())
    }

    pub fn add_month(&mut self, month: &str, raw: &[u8]) -> Res<()> {
        let Some(mj) = self.months.iter().find(|m| m.month == month) else {
            bail!("month '{month}' is not in the index manifest");
        };
        let n = self.ncells();
        let want = 2 * n * mj.words * 8;
        if raw.len() != want {
            bail!("month {month}: expected {want} bytes, got {}", raw.len());
        }
        let v: Vec<u64> = raw
            .chunks_exact(8)
            .map(|c| u64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]))
            .collect();
        self.month_data.insert(month.to_string(), v);
        Ok(())
    }

    pub fn add_band(&mut self, band: usize, raw: &[u8]) -> Res<()> {
        let row_bytes = self.grid.nx * self.n_az * 2;
        if raw.len() == 0 || raw.len() % row_bytes != 0 || raw.len() / row_bytes > self.rows_per_band {
            bail!("horizon band {band}: bad size {} (row = {row_bytes} bytes)", raw.len());
        }
        let v: Vec<i16> = raw.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        self.bands.insert(band, v);
        Ok(())
    }

    pub fn band_of_cell(&self, c: usize) -> usize {
        (c / self.grid.nx) / self.rows_per_band
    }

    /// Horizon (deg) of one cell from its band.
    pub fn cell_horizon(&self, c: usize) -> Res<Vec<f32>> {
        let (i, j) = (c / self.grid.nx, c % self.grid.nx);
        let b = i / self.rows_per_band;
        let Some(band) = self.bands.get(&b) else {
            bail!("horizon band {b} not loaded (needed for cell {c})");
        };
        let off = ((i % self.rows_per_band) * self.grid.nx + j) * self.n_az;
        if off + self.n_az > band.len() {
            bail!("horizon band {b} too short for cell {c}");
        }
        let s = &band[off..off + self.n_az];
        if s[0] == i16::MIN {
            bail!("cell {c} has no horizon (invalid cell)");
        }
        Ok(s.iter().map(|&v| (v as f64 * self.scale_deg) as f32).collect())
    }

    /// Month spans covering [t0, t1): (month index, first step, end step).
    pub fn month_spans(&self, t0: f64, t1: f64) -> Res<Vec<(usize, usize, usize)>> {
        let mut out = Vec::new();
        let (mut first, mut last) = (f64::INFINITY, f64::NEG_INFINITY);
        for (mi, m) in self.months.iter().enumerate() {
            let end = m.t0_unix + m.n_steps as f64 * self.step_s;
            first = first.min(m.t0_unix);
            last = last.max(end);
            let lo = ((t0 - m.t0_unix) / self.step_s).ceil().max(0.0) as usize;
            let hi = (((t1 - m.t0_unix) / self.step_s).ceil().max(0.0) as usize).min(m.n_steps);
            if hi > lo {
                out.push((mi, lo, hi));
            }
        }
        if out.is_empty() || t0 < first - 1.0 || t1 > last + 1.0 {
            bail!("window is not covered by the index months (coverage {first}..{last} unix s)");
        }
        Ok(out)
    }

    pub fn months_needed(&self, t0: f64, t1: f64) -> Res<Vec<String>> {
        Ok(self.month_spans(t0, t1)?.into_iter().map(|(mi, _, _)| self.months[mi].month.clone()).collect())
    }

    pub fn static_value(&self, name: &str, c: usize) -> Option<f64> {
        match name {
            "lat" => Some(self.lat[c]),
            "lon" => Some(self.lon[c]),
            _ => self.statics.get(name).map(|v| v[c] as f64).filter(|v| v.is_finite()),
        }
    }
}
