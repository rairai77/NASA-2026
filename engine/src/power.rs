//! Simple solar power / battery model on top of the visibility series.
use crate::error::Res;
use crate::metrics::{longest_run_bool, Metrics};
use crate::visibility::Series;
use crate::bail;
use serde::Deserialize;

pub const SOLAR_CONSTANT: f64 = 1361.0;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Panel {
    /// "vertical_fixed" | "vertical_tracking" | "horizontal"
    pub kind: String,
    #[serde(alias = "azimuth_deg")]
    pub azimuth_deg: Option<f64>,
    #[serde(alias = "area_m2")]
    pub area_m2: f64,
    pub efficiency: f64,
    #[serde(alias = "load_w")]
    pub load_w: f64,
    #[serde(alias = "depth_of_discharge")]
    pub depth_of_discharge: f64,
    /// Optional battery capacity (Wh) for the survives-night flag.
    #[serde(alias = "battery_wh")]
    pub battery_wh: Option<f64>,
}

pub struct PowerResult {
    pub power_w: Vec<f32>,
    pub energy_wh: f64,
    pub wh_per_day: f64,
    pub battery_wh_needed: f64,
    pub longest_dark_h: f64,
    pub survives_night: bool,
}

pub fn power(s: &Series, p: &Panel) -> Res<PowerResult> {
    if !(p.depth_of_discharge > 0.0 && p.depth_of_discharge <= 1.0) {
        bail!("panel.depthOfDischarge must be in (0, 1]");
    }
    let kind = p.kind.as_str();
    if !matches!(kind, "vertical_fixed" | "vertical_tracking" | "horizontal") {
        bail!("panel.kind must be vertical_fixed, vertical_tracking or horizontal");
    }
    let pa = p.azimuth_deg.unwrap_or(0.0);
    let k0 = SOLAR_CONSTANT * p.area_m2 * p.efficiency;
    let h = s.step_s / 3600.0;
    let mut pw = Vec::with_capacity(s.t.len());
    let mut e = 0.0;
    for k in 0..s.t.len() {
        let el = (s.sun_el[k] as f64).to_radians();
        let inc = match kind {
            "vertical_tracking" => el.cos(),
            "vertical_fixed" => el.cos() * (((s.sun_az[k] as f64) - pa).to_radians().cos()).max(0.0),
            _ => el.sin(),
        }
        .max(0.0);
        let w = if el > 0.0 { k0 * s.sun_frac[k] as f64 * inc } else { 0.0 };
        e += w * h;
        pw.push(w as f32);
    }
    let days = s.t.len() as f64 * h / 24.0;
    let dark = longest_run_bool(s.sun_up.iter().map(|&b| b == 0)) as f64 * h;
    let need = p.load_w * dark / p.depth_of_discharge;
    Ok(PowerResult {
        power_w: pw,
        energy_wh: e,
        wh_per_day: if days > 0.0 { e / days } else { 0.0 },
        battery_wh_needed: need,
        longest_dark_h: dark,
        survives_night: match p.battery_wh {
            Some(c) => c >= need,
            None => dark == 0.0,
        },
    })
}

/// Add `energy_wh` and `battery_wh_needed` to a metrics map.
pub fn add_metrics(m: &mut Metrics, s: &Series, p: &Panel) -> Res<()> {
    let r = power(s, p)?;
    m.insert("energy_wh".into(), r.energy_wh);
    m.insert("battery_wh_needed".into(), r.battery_wh_needed);
    Ok(())
}
