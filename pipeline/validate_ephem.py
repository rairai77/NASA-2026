"""Compare reference/sky.py (from ephem.f32) with JPL Horizons apparent az/el (airless, geometric-ish).

Horizons: CENTER='coord@301' (Moon, MEAN_ME high precision, radii 1737.4 sphere, altitude above that sphere),
QUANTITIES=4 (airless apparent az/el, includes light time, light bending, stellar aberration).
"""
import sys
import numpy as np
import requests
from reference.sky import Ephem, azel

SITES = {"Apollo 11": (0.67416, 23.47314), "polar (-89.45, 222.69)": (-89.45, 222.69),
         "Malapert-ish (-85.99, 2.84)": (-85.99, 2.84)}
# UTC unix times across 2026-2030 (JD list for Horizons)
TIMES = [1767225600 + k * 86400 * 91 + k * 3600 * 5 + k * 777 for k in range(0, 20)]  # ~every quarter, odd hours
H_M = 0.0
BODIES = {"Sun": "10", "Earth": "399"}

def horizons(cmd, lat, lon, h_m, times):
    jds = [f"{t / 86400 + 2440587.5:.8f}" for t in times]
    p = dict(format="json", COMMAND=f"'{cmd}'", CENTER="'coord@301'", COORD_TYPE="'GEODETIC'",
             SITE_COORD=f"'{lon % 360:.6f},{lat:.6f},{h_m / 1000:.6f}'", TLIST_TYPE="'JD'", TIME_TYPE="'UT'",
             TLIST="'" + " ".join(jds) + "'", QUANTITIES="'4'", CSV_FORMAT="'YES'", ANG_FORMAT="'DEG'")
    r = requests.get("https://ssd.jpl.nasa.gov/api/horizons.api", params=p, timeout=120).json()
    res = r["result"]
    rows = res.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
    out = []
    for ln in rows:
        f = [x.strip() for x in ln.split(",")]
        out.append((float(f[3]), float(f[4])))
    assert len(out) == len(times), res[:500]
    return np.array(out)

def main(h_m=H_M):
    eph = Ephem()
    t = np.array(TIMES, dtype=float)
    print(f"{'site':30s} {'body':6s} max|d_az*cos(el)|  max|d_el|   (deg, h={h_m} m, n={len(t)})")
    worst = 0
    for name, (lat, lon) in SITES.items():
        for b, cmd in BODIES.items():
            hz = horizons(cmd, lat, lon, h_m, t)
            az, el = azel(eph, lat, lon, h_m, t, b.lower())
            daz = (az - hz[:, 0] + 180) % 360 - 180
            dxaz = np.abs(daz * np.cos(np.radians(hz[:, 1])))
            dxel = np.abs(el - hz[:, 1])
            worst = max(worst, dxaz.max(), dxel.max())
            print(f"{name:30s} {b:6s} {dxaz.max():12.5f} {dxel.max():12.5f}")
    print("WORST", worst, "PASS" if worst < 0.05 else "FAIL")
    return worst

if __name__ == "__main__":
    sys.exit(0 if main(float(sys.argv[1]) if len(sys.argv) > 1 else H_M) < 0.05 else 1)
