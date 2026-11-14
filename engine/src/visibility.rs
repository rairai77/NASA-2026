//! Sun/Earth in the local sky: az/el, visible Sun fraction vs horizon, eclipse,
//! time series and rise/set events.
use crate::bail;
use crate::ephem::Ephemeris;
use crate::error::Res;
use crate::geo::*;
use crate::horizon::interp_horizon;
use serde::Serialize;
use std::f64::consts::PI;

/// Observer geometry: ENU basis and position (km, MOON_ME).
pub struct Site {
    pub e: V3,
    pub n: V3,
    pub u: V3,
    pub p_km: V3,
}

impl Site {
    /// `r_obs_m` = R + terrain height + observer height.
    pub fn new(lat_deg: f64, lon_deg: f64, r_obs_m: f64) -> Self {
        let lat = nudge_lat(lat_deg);
        let b = enu(lat, lon_deg);
        Site { e: b.e, n: b.n, u: b.u, p_km: scale(&b.u, r_obs_m / 1000.0) }
    }
}

#[derive(Clone, Debug)]
pub struct Sky {
    pub sun_az: f64,
    pub sun_el: f64,
    pub sun_r_deg: f64,
    pub earth_az: f64,
    pub earth_el: f64,
    pub earth_r_deg: f64,
    pub eclipse_frac: f64,
    /// Sun visible fraction (horizon and eclipse included).
    pub sun_frac: f64,
    /// Horizon-limited visible fraction (no eclipse factor); used for rise/set events.
    pub sun_frac_hz: f64,
    pub sun_hz: f64,
    pub earth_hz: f64,
    pub sun_unit: V3,
    pub earth_unit: V3,
}

impl Sky {
    #[inline]
    pub fn sun_up(&self) -> bool {
        self.sun_frac >= 0.5
    }
    #[inline]
    pub fn earth_up(&self) -> bool {
        self.earth_el > self.earth_hz
    }
    /// Eclipse partially covering the Sun while the Sun is above the horizon.
    #[inline]
    pub fn eclipse_active(&self) -> bool {
        self.eclipse_frac > 0.0 && self.sun_el > self.sun_hz
    }
}

/// Visible fraction of a disc of angular radius `r` (rad) centred `rel` (rad)
/// above a flat horizon.
#[inline]
pub fn sun_fraction(rel: f64, r: f64) -> f64 {
    let t = (rel / r).clamp(-1.0, 1.0);
    1.0 - (t.acos() - t * (1.0 - t * t).sqrt()) / PI
}

/// Fraction of the Sun's disc (radius rs) covered by Earth's disc (radius re)
/// at angular separation d (all radians, planar approximation).
pub fn eclipse_fraction(rs: f64, re: f64, d: f64) -> f64 {
    if d >= rs + re {
        return 0.0;
    }
    if d <= (rs - re).abs() {
        return if re >= rs { 1.0 } else { (re * re) / (rs * rs) };
    }
    let a1 = ((d * d + rs * rs - re * re) / (2.0 * d * rs)).clamp(-1.0, 1.0).acos();
    let a2 = ((d * d + re * re - rs * rs) / (2.0 * d * re)).clamp(-1.0, 1.0).acos();
    let k = (-d + rs + re) * (d + rs - re) * (d - rs + re) * (d + rs + re);
    let area = rs * rs * a1 + re * re * a2 - 0.5 * k.max(0.0).sqrt();
    (area / (PI * rs * rs)).clamp(0.0, 1.0)
}

#[inline]
fn azel(site: &Site, v: &V3) -> (f64, f64, f64) {
    let x = dot(v, &site.e);
    let y = dot(v, &site.n);
    let z = dot(v, &site.u);
    let r = norm(v);
    let az = x.atan2(y).to_degrees().rem_euclid(360.0);
    (az, (z / r).clamp(-1.0, 1.0).asin().to_degrees(), r)
}

/// Full sky state for one instant. `hz` is the azimuth-binned horizon (deg).
pub fn sky(site: &Site, sun_km: &V3, earth_km: &V3, hz: &[f32]) -> Sky {
    let vs = sub(sun_km, &site.p_km);
    let ve = sub(earth_km, &site.p_km);
    let (saz, sel, sr) = azel(site, &vs);
    let (eaz, eel, er) = azel(site, &ve);
    let rs = (SUN_RADIUS_KM / sr).min(1.0).asin();
    let re = (EARTH_RADIUS_KM / er).min(1.0).asin();
    let su = scale(&vs, 1.0 / sr);
    let eu = scale(&ve, 1.0 / er);
    let sep = dot(&su, &eu).clamp(-1.0, 1.0).acos();
    let ecl = eclipse_fraction(rs, re, sep);
    let shz = interp_horizon(hz, saz);
    let ehz = interp_horizon(hz, eaz);
    let frac_hz = sun_fraction((sel - shz).to_radians(), rs);
    let frac = frac_hz * (1.0 - ecl);
    Sky {
        sun_az: saz,
        sun_el: sel,
        sun_r_deg: rs.to_degrees(),
        earth_az: eaz,
        earth_el: eel,
        earth_r_deg: re.to_degrees(),
        eclipse_frac: ecl,
        sun_frac: frac,
        sun_frac_hz: frac_hz,
        sun_hz: shz,
        earth_hz: ehz,
        sun_unit: su,
        earth_unit: eu,
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct Event {
    pub t: f64,
    pub kind: &'static str,
}

#[derive(Default, Clone)]
pub struct Series {
    pub step_s: f64,
    pub t: Vec<f64>,
    pub sun_az: Vec<f32>,
    pub sun_el: Vec<f32>,
    pub sun_frac: Vec<f32>,
    pub earth_az: Vec<f32>,
    pub earth_el: Vec<f32>,
    pub earth_up: Vec<u8>,
    pub eclipse_frac: Vec<f32>,
    pub sun_up: Vec<u8>,
    /// Horizon-only Sun fraction (for events).
    pub sun_frac_hz: Vec<f32>,
    pub eclipse_active: Vec<u8>,
    /// Earth centre elevation minus horizon at Earth azimuth (deg), for event interpolation.
    pub earth_rel: Vec<f32>,
}

pub const MAX_STEPS: usize = 3_000_000;

pub fn series(eph: &Ephemeris, site: &Site, hz: &[f32], t_start: f64, t_end: f64, step_s: f64) -> Res<Series> {
    if !(step_s > 0.0) || !(t_end > t_start) {
        bail!("bad time window: start={t_start} end={t_end} step={step_s}");
    }
    let n = ((t_end - t_start) / step_s).ceil() as usize;
    if n > MAX_STEPS {
        bail!("window has {n} steps (max {MAX_STEPS}); increase step_s");
    }
    eph.check_range(t_start, t_start + (n - 1) as f64 * step_s)?;
    let mut s = Series { step_s, ..Default::default() };
    macro_rules! reserve {
        ($($f:ident),*) => { $( s.$f.reserve(n); )* };
    }
    reserve!(t, sun_az, sun_el, sun_frac, earth_az, earth_el, earth_up, eclipse_frac, sun_up, sun_frac_hz, eclipse_active, earth_rel);
    for k in 0..n {
        let t = t_start + k as f64 * step_s;
        let (sun, earth) = eph.at(t).ok_or("ephemeris lookup failed")?;
        let sk = sky(site, &sun, &earth, hz);
        s.t.push(t);
        s.sun_az.push(sk.sun_az as f32);
        s.sun_el.push(sk.sun_el as f32);
        s.sun_frac.push(sk.sun_frac as f32);
        s.earth_az.push(sk.earth_az as f32);
        s.earth_el.push(sk.earth_el as f32);
        s.earth_up.push(sk.earth_up() as u8);
        s.eclipse_frac.push(sk.eclipse_frac as f32);
        s.sun_up.push(sk.sun_up() as u8);
        s.sun_frac_hz.push(sk.sun_frac_hz as f32);
        s.eclipse_active.push(sk.eclipse_active() as u8);
        s.earth_rel.push((sk.earth_el - sk.earth_hz) as f32);
    }
    Ok(s)
}

/// Rise/set and eclipse events. Rise/set times are interpolated linearly to
/// the crossing of Sun fraction 0.5 / Earth centre at the horizon.
pub fn events(s: &Series) -> Vec<Event> {
    let mut ev = Vec::new();
    let cross = |k: usize, a: f64, b: f64| -> f64 {
        // a at k-1, b at k; crossing of zero
        let w = if (b - a).abs() > 1e-12 { (-a / (b - a)).clamp(0.0, 1.0) } else { 1.0 };
        s.t[k - 1] + w * s.step_s
    };
    for k in 1..s.t.len() {
        // rise/set follow the horizon-limited fraction only (eclipses are separate events)
        let (f0, f1) = (s.sun_frac_hz[k - 1] as f64, s.sun_frac_hz[k] as f64);
        if (f0 >= 0.5) != (f1 >= 0.5) {
            let t = cross(k, f0 - 0.5, f1 - 0.5);
            ev.push(Event { t, kind: if f1 >= 0.5 { "sunrise" } else { "sunset" } });
        }
        let (e0, e1) = (s.earth_up[k - 1], s.earth_up[k]);
        if e0 != e1 {
            let t = cross(k, s.earth_rel[k - 1] as f64, s.earth_rel[k] as f64);
            ev.push(Event { t, kind: if e1 == 1 { "earthrise" } else { "earthset" } });
        }
        let (c0, c1) = (s.eclipse_active[k - 1], s.eclipse_active[k]);
        if c0 != c1 {
            ev.push(Event { t: s.t[k], kind: if c1 == 1 { "eclipse_start" } else { "eclipse_end" } });
        }
    }
    ev.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap());
    ev
}
