//! Ephemeris table: Sun and Earth positions (km, MOON_ME) on a uniform UTC grid.
use crate::bail;
use crate::error::Res;
use crate::geo::V3;
use serde::Deserialize;

#[derive(Deserialize)]
struct Meta {
    t0_unix: f64,
    step_s: f64,
    n: usize,
}

pub struct Ephemeris {
    pub t0: f64,
    pub step_s: f64,
    pub n: usize,
    data: Vec<f32>, // n * 6
}

impl Ephemeris {
    pub fn from_bytes(meta_json: &str, bytes: &[u8]) -> Res<Self> {
        let m: Meta = serde_json::from_str(meta_json)?;
        if bytes.len() != m.n * 6 * 4 {
            bail!("ephemeris: expected {} bytes for n={}, got {}", m.n * 24, m.n, bytes.len());
        }
        if m.n < 2 || m.step_s <= 0.0 {
            bail!("ephemeris: bad meta (n={}, step_s={})", m.n, m.step_s);
        }
        let data = bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        Ok(Self { t0: m.t0_unix, step_s: m.step_s, n: m.n, data })
    }

    pub fn t_end(&self) -> f64 {
        self.t0 + (self.n - 1) as f64 * self.step_s
    }

    /// Linearly interpolated (sun, earth) positions in km. None outside the table.
    #[inline]
    pub fn at(&self, t: f64) -> Option<(V3, V3)> {
        let f = (t - self.t0) / self.step_s;
        if !(f >= 0.0) {
            return None;
        }
        let mut i = f.floor() as usize;
        let mut w = f - i as f64;
        if i >= self.n - 1 {
            if i == self.n - 1 && w == 0.0 {
                i = self.n - 2;
                w = 1.0;
            } else {
                return None;
            }
        }
        let a = &self.data[i * 6..i * 6 + 6];
        let b = &self.data[i * 6 + 6..i * 6 + 12];
        let l = |k: usize| a[k] as f64 * (1.0 - w) + b[k] as f64 * w;
        Some(([l(0), l(1), l(2)], [l(3), l(4), l(5)]))
    }

    pub fn check_range(&self, t_start: f64, t_end: f64) -> Res<()> {
        if t_start < self.t0 || t_end > self.t_end() + 1e-6 {
            bail!(
                "time window [{t_start}, {t_end}) outside ephemeris coverage [{}, {}]",
                self.t0,
                self.t_end()
            );
        }
        Ok(())
    }
}
