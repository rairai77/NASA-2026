"""Native (Python wheel) vs WASM (Node) parity on real data: 20 sites, 720-az horizon + 30-day visibility.
Fails if hours metrics differ by > 1 minute or angles by > 0.01 deg.
    pipeline/.venv/bin/python engine/parity/run_parity.py      (needs web/src/engine/pkg built)
"""
import json, os, subprocess, sys, tempfile
import numpy as np
import lunar_engine as le

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../.."))
D = os.path.join(ROOT, "web/public/data")
IDS = ["im1", "im2", "chandrayaan3", "art3_haworth", "art3_malapert_massif", "art3_nobile_rim_1", "ref_shackleton_ridge_a",
       "ref_shackleton_ridge_d", "ref_degerlache_ridge_c", "change7", "art3_slater_plain", "art3_cabeus_b_peak",
       "apollo11", "apollo12", "apollo14", "apollo15", "apollo16", "apollo17", "slim", "change4"]
T0, T1 = 1772323200.0, 1772323200.0 + 30 * 86400  # 2026-03-01 .. 2026-03-31
sites = [s for s in json.load(open(os.path.join(ROOT, "data-src/sites.json"))) if s["id"] in IDS]
assert len(sites) == 20
e = le.Engine()
e.load_terrain_dir(D)
e.load_ephemeris_files(f"{D}/ephem/ephem.json", f"{D}/ephem/ephem.f32")
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
    json.dump(sites, f)
node = json.loads(subprocess.check_output(["node", os.path.join(HERE, "parity_node.mjs"), D, f.name, str(T0), str(T1)], text=True))
HOURS = ("sun_hours", "earth_hours", "both_hours", "eclipse_hours", "longest_sun_h", "longest_dark_h", "longest_earth_h",
         "longest_no_earth_h", "longest_both_h")
ANGLES = ("mean_sun_el_deg", "min_sun_el_deg")
worst_h = worst_a = worst_hz = 0.0
for s in sites:
    info = e.horizon_info(s["lat"], s["lon"], 2.0, 720)
    v = e.visibility(s["lat"], s["lon"], 2.0, info["elev_deg"], T0, T1, 900.0)
    n = node[s["id"]]
    dhz = np.abs(np.array(n["horizon"]) - info["elev_deg"]).max()
    dh = max(abs(v["metrics"].get(k, 0) - n["metrics"].get(k, 0)) for k in HOURS) * 60  # minutes
    da = max(abs(v["metrics"].get(k, 0) - n["metrics"].get(k, 0)) for k in ANGLES)
    worst_h, worst_a, worst_hz = max(worst_h, dh), max(worst_a, da), max(worst_hz, dhz)
    print(f"{s['id']:26s} res {info['resolution_m']:5.0f} m  z {info['site_elev_m']:7.1f}  sun_h {v['metrics']['sun_hours']:6.1f}  "
          f"d_horizon {dhz:.2e} deg  d_hours {dh:.3f} min  d_angle {da:.2e} deg")
ok = worst_h <= 1.0 and worst_a <= 0.01 and worst_hz <= 0.01
print(f"WORST horizon {worst_hz:.2e} deg, hours {worst_h:.3f} min, angles {worst_a:.2e} deg ->", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
