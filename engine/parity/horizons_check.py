"""Engine (Python wheel) sun_earth_at vs JPL Horizons airless apparent az/el.
Same 3 sites x 20 times as pipeline/validate_ephem.py; site height 0 above the 1737.4 km sphere.
    pipeline/.venv/bin/python engine/parity/horizons_check.py
"""
import os, sys
import numpy as np
import requests
import lunar_engine as le

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
D = os.path.join(ROOT, "web/public/data")
SITES = {"Apollo 11": (0.67416, 23.47314), "polar (-89.45, 222.69)": (-89.45, 222.69),
         "Malapert-ish (-85.99, 2.84)": (-85.99, 2.84)}
TIMES = [1767225600 + k * 86400 * 91 + k * 3600 * 5 + k * 777 for k in range(20)]
BODIES = {"sun": "10", "earth": "399"}

def horizons(cmd, lat, lon):
    jds = [f"{t / 86400 + 2440587.5:.8f}" for t in TIMES]
    p = dict(format="json", COMMAND=f"'{cmd}'", CENTER="'coord@301'", COORD_TYPE="'GEODETIC'",
             SITE_COORD=f"'{lon % 360:.6f},{lat:.6f},0.0'", TLIST_TYPE="'JD'", TIME_TYPE="'UT'",
             TLIST="'" + " ".join(jds) + "'", QUANTITIES="'4'", CSV_FORMAT="'YES'", ANG_FORMAT="'DEG'")
    res = requests.get("https://ssd.jpl.nasa.gov/api/horizons.api", params=p, timeout=120).json()["result"]
    rows = res.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
    out = [[float(x) for x in ln.split(",")[3:5]] for ln in rows]
    assert len(out) == len(TIMES), res[:400]
    return np.array(out)

e = le.Engine()
e.load_ephemeris_files(f"{D}/ephem/ephem.json", f"{D}/ephem/ephem.f32")
worst = 0.0
print(f"{'site':30s} {'body':6s} max|d_az*cos(el)|  max|d_el|  (deg, n={len(TIMES)})")
for name, (lat, lon) in SITES.items():
    se = [e.sun_earth_at(lat, lon, float(t)) for t in TIMES]
    for b, cmd in BODIES.items():
        hz = horizons(cmd, lat, lon)
        az = np.array([s[f"{b}_az"] for s in se]); el = np.array([s[f"{b}_el"] for s in se])
        daz = (az - hz[:, 0] + 180) % 360 - 180
        dxaz = np.abs(daz * np.cos(np.radians(hz[:, 1]))); dxel = np.abs(el - hz[:, 1])
        worst = max(worst, dxaz.max(), dxel.max())
        print(f"{name:30s} {b:6s} {dxaz.max():12.5f} {dxel.max():12.5f}")
print("WORST", round(worst, 5), "PASS" if worst < 0.05 else "FAIL")
sys.exit(0 if worst < 0.05 else 1)
