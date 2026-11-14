//! Real comms: DSN visibility of the Moon, Earth link margin class, comms metrics.
use crate::bail;
use crate::error::Res;
use crate::metrics::{longest_run_bool, Metrics};
use crate::visibility::Series;
use serde::Deserialize;

/// A DSN station counts as "in view" when the Moon's elevation there is >= this (deg).
pub const DSN_MIN_EL_DEG: f64 = 10.0;
/// Earth centre within this many degrees above the local skyline = marginal
/// (single knife-edge diffraction regime).
pub const MARGINAL_DEG: f64 = 1.5;

#[derive(Deserialize)]
struct Meta {
    t0_unix: f64,
    step_s: f64,
    n: usize,
    #[serde(default = "default_scale")]
    scale: f64,
}
fn default_scale() -> f64 {
    0.01
}

pub struct Dsn {
    t0: f64,
    step_s: f64,
    n: usize,
    scale: f64,
    data: Vec<i16>, // n x 3
}

impl Dsn {
    pub fn from_bytes(meta_json: &str, bytes: &[u8]) -> Res<Self> {
        let m: Meta = serde_json::from_str(meta_json)?;
        if bytes.len() != m.n * 3 * 2 {
            bail!("dsn: expected {} bytes for n={}, got {}", m.n * 6, m.n, bytes.len());
        }
        let data = bytes.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        Ok(Self { t0: m.t0_unix, step_s: m.step_s, n: m.n, scale: m.scale, data })
    }

    /// Bitmask of stations in view at time t (bit0 Goldstone, bit1 Canberra, bit2 Madrid),
    /// with linearly interpolated elevations. None outside the table.
    pub fn up_mask(&self, t: f64) -> Option<u8> {
        let f = (t - self.t0) / self.step_s;
        if !(f >= 0.0) || f > (self.n - 1) as f64 {
            return None;
        }
        let i = (f.floor() as usize).min(self.n - 2);
        let w = f - i as f64;
        let mut mask = 0u8;
        for k in 0..3 {
            let a = self.data[i * 3 + k] as f64;
            let b = self.data[(i + 1) * 3 + k] as f64;
            if (a * (1.0 - w) + b * w) * self.scale >= DSN_MIN_EL_DEG {
                mask |= 1 << k;
            }
        }
        Some(mask)
    }
}

pub struct Comms {
    /// Present when DSN data is loaded or relay is assumed.
    pub dsn_up: Option<Vec<u8>>,
    /// 0 = no Earth line of sight, 1 = marginal, 2 = clear.
    pub link_margin: Vec<u8>,
    pub metrics: Metrics,
}

pub fn compute(s: &Series, dsn: Option<&Dsn>, relay: bool) -> Res<Comms> {
    let n = s.t.len();
    let h = s.step_s / 3600.0;
    let link: Vec<u8> = (0..n)
        .map(|k| {
            if s.earth_up[k] == 0 {
                0
            } else if (s.earth_rel[k] as f64) < MARGINAL_DEG {
                1
            } else {
                2
            }
        })
        .collect();
    let mut metrics = Metrics::new();
    metrics.insert("marginal_hours".into(), link.iter().filter(|&&v| v == 1).count() as f64 * h);
    let mut dsn_up = None;
    if relay || dsn.is_some() {
        let mask: Vec<u8> = if relay {
            vec![7; n]
        } else {
            let d = dsn.unwrap();
            let mut v = Vec::with_capacity(n);
            for &t in &s.t {
                match d.up_mask(t) {
                    Some(m) => v.push(m),
                    None => bail!("time {t} outside DSN table coverage"),
                }
            }
            v
        };
        let ok = |k: usize| relay || (s.earth_up[k] == 1 && mask[k] != 0);
        metrics.insert("comms_hours".into(), (0..n).filter(|&k| ok(k)).count() as f64 * h);
        metrics.insert("longest_comms_h".into(), longest_run_bool((0..n).map(ok)) as f64 * h);
        dsn_up = Some(mask);
    }
    Ok(Comms { dsn_up, link_margin: link, metrics })
}
