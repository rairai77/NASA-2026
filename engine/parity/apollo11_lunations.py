"""Sanity: Apollo 11 Sun-up hours per synodic lunation, averaged over 12 lunations (expect ~354.5 h = 14.77 d)."""
import os, numpy as np, lunar_engine as le
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../web/public/data")
e = le.Engine(); e.load_terrain_dir(D); e.load_ephemeris_files(f"{D}/ephem/ephem.json", f"{D}/ephem/ephem.f32")
lat, lon = 0.67416, 23.47314
hz = e.horizon(lat, lon, 2.0, 720)
L = 29.530589 * 86400; t0 = 1767225600.0
vals = []
for k in range(12):
    v = e.visibility(lat, lon, 2.0, hz, t0 + k * L, t0 + (k + 1) * L, 900.0)
    vals.append(v["metrics"]["sun_hours"])
print("per lunation (h):", [round(x, 1) for x in vals])
m = float(np.mean(vals)); print(f"mean {m:.1f} h = {m / 24:.2f} d (half lunation 354.3 h)", "PASS" if abs(m - 355) < 5 else "FAIL")
