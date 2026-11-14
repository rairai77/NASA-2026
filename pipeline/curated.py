"""Curated per-site precompute (CONTRACTS §4): web/public/data/curated.json.

horizon (720 az, h=2 m), resolution_m, site_elev_m, monthly window metrics 2026-01..2030-12 (900 s steps),
and `best_nearby` for candidate regions / representative south-polar sites: the valid index cell within 10 km
with the highest sun_frac_5yr (ties broken by nearest).
"""
import calendar, datetime as dt, json, sys, time
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import geo  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"
H = 2.0

def r(v, nd):
    return None if v is None or not np.isfinite(v) else round(float(v), nd)

def main():
    import lunar_engine
    t_all = time.time()
    eng = lunar_engine.Engine()
    eng.load_ephemeris_files(str(DATA / "ephem" / "ephem.json"), str(DATA / "ephem" / "ephem.f32"))
    n = eng.load_terrain_dir(str(DATA)); print(f"loaded {n} tiles ({time.time()-t_all:.0f}s)", flush=True)
    sites = json.loads((ROOT / "data-src" / "sites.json").read_text())
    im = json.loads((DATA / "index" / "manifest.json").read_text())
    g = im["grid"]; nx, ny = g["nx"], g["ny"]
    st = np.fromfile(DATA / "index" / "static.f32", "<f4").reshape(len(im["static"]["columns"]), ny, nx)
    col = {c: st[i] for i, c in enumerate(im["static"]["columns"])}
    jj, ii = np.meshgrid(np.arange(nx), np.arange(ny))
    cx, cy = g["x0"] + (jj + .5) * g["cell_m"], g["y0"] - (ii + .5) * g["cell_m"]
    valid = np.isfinite(col["lat"])
    lat_c, lon_c = np.radians(col["lat"]), np.radians(col["lon"])
    cu = np.stack([np.cos(lat_c) * np.cos(lon_c), np.cos(lat_c) * np.sin(lon_c), np.sin(lat_c)], -1)

    months = []
    for y in range(2026, 2031):
        for m in range(1, 13):
            a = dt.datetime(y, m, 1, tzinfo=dt.timezone.utc)
            b = dt.datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=dt.timezone.utc)
            months.append((f"{y}-{m:02d}", a.timestamp(), b.timestamp()))

    out = {}
    for s in sites:
        t = time.time()
        info = eng.horizon_info(s["lat"], s["lon"], H, 720)
        hz = np.asarray(info["elev_deg"], np.float32)
        zs = info["site_elev_m"]
        rec = {"horizon": [r(v, 3) for v in hz], "resolution_m": r(info["resolution_m"], 1), "site_elev_m": r(zs, 2), "monthly": []}
        for name, t0, t1 in months:
            v = eng.visibility(s["lat"], s["lon"], H, hz, t0, t1, 900.0, zs)
            rec["monthly"].append({"month": name, **{k: r(x, 4) for k, x in v["metrics"].items()}})
        if (s["kind"] == "candidate_region" or s.get("representative")) and s["lat"] <= -85:
            la, lo = np.radians(s["lat"]), np.radians(s["lon"])
            u = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
            ang = np.arccos(np.clip(cu @ u, -1, 1))
            d = ang * geo.R / 1000.0
            ok = valid & (d <= 10.0) & np.isfinite(col["sun_frac_5yr"])
            if ok.any():
                score = np.where(ok, col["sun_frac_5yr"] - 1e-6 * d, -np.inf)
                k = np.unravel_index(np.argmax(score), score.shape)
                rec["best_nearby"] = {"lat": r(col["lat"][k], 4), "lon": r(col["lon"][k], 4),
                                      "sun_frac_5yr": r(col["sun_frac_5yr"][k], 4), "earth_frac_5yr": r(col["earth_frac_5yr"][k], 4),
                                      "distance_km": r(d[k], 2)}
        out[s["id"]] = rec
        print(f"{s['id']:28s} res {rec['resolution_m']} z {rec['site_elev_m']} {time.time()-t:.1f}s" + (f" best_nearby {rec['best_nearby']}" if "best_nearby" in rec else ""), flush=True)
    p = DATA / "curated.json"
    p.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {p} {p.stat().st_size/1e6:.2f} MB, {len(out)} sites, {time.time()-t_all:.0f}s")

if __name__ == "__main__":
    main()
