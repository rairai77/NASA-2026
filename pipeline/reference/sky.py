"""numpy reference for topocentric Sun/Earth az/el from ephem.f32 (CONTRACTS §0, §1, §7).

Site P = (R + h) * unit(lat, lon) (MOON_ME, km); v = B - P with B linearly interpolated between
ephemeris rows; ENU basis from lat/lon; azimuth clockwise from north; elevation geometric (no refraction).
"""
import json
from pathlib import Path
import numpy as np

R_KM = 1737.4
DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"

class Ephem:
    def __init__(self, data_dir=DATA):
        d = Path(data_dir) / "ephem"
        self.meta = json.loads((d / "ephem.json").read_text())
        self.rows = np.fromfile(d / "ephem.f32", "<f4").reshape(-1, 6).astype(np.float64)
        assert len(self.rows) == self.meta["n"]

    def body(self, t_unix, which):
        """Interpolated body position (km, MOON_ME); which = 'sun' or 'earth'."""
        f = (np.asarray(t_unix, dtype=np.float64) - self.meta["t0_unix"]) / self.meta["step_s"]
        i = np.clip(np.floor(f).astype(int), 0, self.meta["n"] - 2)
        w = (f - i)[..., None]
        c = slice(0, 3) if which == "sun" else slice(3, 6)
        return (1 - w) * self.rows[i, c] + w * self.rows[i + 1, c]

def enu_basis(lat_deg, lon_deg):
    la, lo = np.radians(lat_deg), np.radians(lon_deg)
    up = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
    east = np.array([-np.sin(lo), np.cos(lo), 0.0])
    north = np.array([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)])
    return east, north, up

def azel(eph, lat_deg, lon_deg, h_m, t_unix, which):
    """Returns (az_deg in [0,360), el_deg) arrays shaped like t_unix."""
    e, n, u = enu_basis(lat_deg, lon_deg)
    P = (R_KM + h_m / 1000.0) * u
    v = eph.body(t_unix, which) - P
    az = np.degrees(np.arctan2(v @ e, v @ n)) % 360.0
    el = np.degrees(np.arcsin((v @ u) / np.linalg.norm(v, axis=-1)))
    return az, el
