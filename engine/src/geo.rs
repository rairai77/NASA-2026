//! Geometry helpers: constants, lat/lon <-> unit vectors, polar stereographic
//! projection, local east-north-up basis, great-circle destination.

pub const R: f64 = 1_737_400.0; // lunar reference radius, m
pub const SUN_RADIUS_KM: f64 = 696_000.0;
/// Mean Earth radius (km) used for Earth's angular radius seen from the Moon.
pub const EARTH_RADIUS_KM: f64 = 6371.0;

pub type V3 = [f64; 3];

#[inline]
pub fn dot(a: &V3, b: &V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
#[inline]
pub fn sub(a: &V3, b: &V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
#[inline]
pub fn norm(a: &V3) -> f64 {
    dot(a, a).sqrt()
}
#[inline]
pub fn scale(a: &V3, s: f64) -> V3 {
    [a[0] * s, a[1] * s, a[2] * s]
}

/// Unit vector for planetocentric lat/lon (degrees), MOON_ME body-fixed axes.
pub fn unit_from_latlon(lat_deg: f64, lon_deg: f64) -> V3 {
    let (sp, cp) = lat_deg.to_radians().sin_cos();
    let (sl, cl) = lon_deg.to_radians().sin_cos();
    [cp * cl, cp * sl, sp]
}

/// (lat, lon) in degrees, lon in [-180, 180].
pub fn latlon_from_unit(u: &V3) -> (f64, f64) {
    let lat = u[2].clamp(-1.0, 1.0).asin().to_degrees();
    let lon = u[1].atan2(u[0]).to_degrees();
    (lat, lon)
}

pub fn wrap180(lon: f64) -> f64 {
    (lon + 180.0).rem_euclid(360.0) - 180.0
}

/// Keep clear of the poles where the ENU basis degenerates.
pub fn nudge_lat(lat: f64) -> f64 {
    lat.clamp(-89.9999, 89.9999)
}

/// Forward spherical south-polar stereographic (true scale at the pole, lon 0 up).
pub fn south_stereo_fwd(u: &V3) -> (f64, f64) {
    let k = 2.0 * R / (1.0 - u[2]);
    (u[1] * k, u[0] * k)
}

/// Inverse: (x, y) metres -> (lat, lon) degrees.
pub fn south_stereo_inv(x: f64, y: f64) -> (f64, f64) {
    let rho = x.hypot(y);
    let lat = -90.0 + 2.0 * (rho / (2.0 * R)).atan().to_degrees();
    let lon = x.atan2(y).to_degrees();
    (lat, lon)
}

pub struct Enu {
    pub e: V3,
    pub n: V3,
    pub u: V3,
}

pub fn enu(lat_deg: f64, lon_deg: f64) -> Enu {
    let (sp, cp) = lat_deg.to_radians().sin_cos();
    let (sl, cl) = lon_deg.to_radians().sin_cos();
    Enu {
        e: [-sl, cl, 0.0],
        n: [-sp * cl, -sp * sl, cp],
        u: [cp * cl, cp * sl, sp],
    }
}

/// Point reached from (lat, lon) travelling `dist_m` along azimuth `az_deg`.
pub fn destination(lat_deg: f64, lon_deg: f64, az_deg: f64, dist_m: f64) -> (f64, f64) {
    let b = enu(nudge_lat(lat_deg), lon_deg);
    let (sa, ca) = az_deg.to_radians().sin_cos();
    let t = [
        ca * b.n[0] + sa * b.e[0],
        ca * b.n[1] + sa * b.e[1],
        ca * b.n[2] + sa * b.e[2],
    ];
    let th = dist_m / R;
    let (s, c) = th.sin_cos();
    let p = [
        c * b.u[0] + s * t[0],
        c * b.u[1] + s * t[1],
        c * b.u[2] + s * t[2],
    ];
    latlon_from_unit(&p)
}

/// Great-circle distance (m) between unit vectors.
pub fn gc_dist_m(a: &V3, b: &V3) -> f64 {
    let d = sub(a, b);
    2.0 * R * (norm(&d) * 0.5).min(1.0).asin()
}
