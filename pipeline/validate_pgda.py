"""Compare our region index against NASA PGDA product 69 (LOLA average illumination / Earth visibility / PSR).

  uv run python validate_pgda.py --fetch     download the 240 m PGDA GeoTIFFs (resumable, ~84 MB)
  uv run python validate_pgda.py             extract PGDA at the 1 km index cell centres -> work/pgda_grid.npz,
                                             then, if ../web/public/data/index/{manifest.json,static.f32} exist,
                                             compare with sun_frac_5yr / earth_frac_5yr (prints + work/pgda_compare.json)
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

from geo import south_stereo_inv
from layers import PGDA, RAW, WORK, load_pgda

INDEX = Path(__file__).parent.parent / "web" / "public" / "data" / "index"
BASE = "https://pgda.gsfc.nasa.gov/data/MoonIllumination/"
GRID = dict(cell_m=1000.0, x0=-152000.0, y0=152000.0, nx=304, ny=304, max_lat=-85.0)  # CONTRACTS §3

def fetch():
    import requests
    d = RAW / "pgda"
    d.mkdir(parents=True, exist_ok=True)
    for name in PGDA.values():
        dest, url = d / name, BASE + name
        size = int(requests.head(url, allow_redirects=True, timeout=60).headers.get("Content-Length", 0))
        have = dest.stat().st_size if dest.exists() else 0
        if size and have == size:
            print("ok  ", name); continue
        hdr = {"Range": f"bytes={have}-"} if have and have < size else {}
        with requests.get(url, headers=hdr, stream=True, timeout=60) as r:
            r.raise_for_status()
            with open(dest, "ab" if hdr and r.status_code == 206 else "wb") as fh:
                for c in r.iter_content(1 << 20):
                    fh.write(c)
        print("done", name)

def grid_centres():
    j, i = np.meshgrid(np.arange(GRID["nx"]), np.arange(GRID["ny"]))
    x = GRID["x0"] + (j + 0.5) * GRID["cell_m"]
    y = GRID["y0"] - (i + 0.5) * GRID["cell_m"]
    lat, lon = south_stereo_inv(x, y)
    return lat, lon

def extract():
    lat, lon = grid_centres()
    valid = lat <= GRID["max_lat"]
    out = {}
    for key in ("illum", "earthvis", "psr"):
        v = load_pgda(key).sample(lat, lon).astype(np.float32)  # bilinear at the cell centre; psr -> fraction 0..1
        v[~valid] = np.nan
        out[key] = v
    WORK.mkdir(exist_ok=True)
    np.savez_compressed(WORK / "pgda_grid.npz", **out)
    print("wrote work/pgda_grid.npz  valid cells:", int(valid.sum()),
          " PGDA NaN inside valid:", int(np.isnan(out["illum"][valid]).sum()))
    return out, valid

def pearson(a, b):
    return float(np.corrcoef(a, b)[0, 1])

def compare(pg, valid):
    man = json.loads((INDEX / "manifest.json").read_text())
    cols = man["static"]["columns"]
    n = GRID["nx"] * GRID["ny"]
    raw = np.fromfile(INDEX / man["static"]["file"].split("/")[-1], dtype="<f4")
    assert raw.size == n * len(cols), (raw.size, n, len(cols))
    ours = {c: raw[k * n:(k + 1) * n].reshape(GRID["ny"], GRID["nx"]) for k, c in enumerate(cols)}
    res = {}
    for name, o, p in (("sun", ours["sun_frac_5yr"], pg["illum"]), ("earth", ours["earth_frac_5yr"], pg["earthvis"])):
        ok = valid & np.isfinite(o) & np.isfinite(p)
        a, b = o[ok], p[ok]
        order = np.argsort(b)
        pick = order[np.linspace(0, len(b) - 1, 20).astype(int)]  # 20 cells spanning the PGDA range
        res[name] = dict(n=int(ok.sum()), r_all=pearson(a, b), r_sample20=pearson(a[pick], b[pick]),
                         bias_ours_minus_pgda=float(np.mean(a - b)), rmse=float(np.sqrt(np.mean((a - b) ** 2))),
                         mean_ours=float(a.mean()), mean_pgda=float(b.mean()))
    ok = valid & np.isfinite(ours["sun_frac_5yr"]) & np.isfinite(pg["psr"])
    o0, p1 = ours["sun_frac_5yr"][ok] == 0, pg["psr"][ok] >= 0.5
    res["psr"] = dict(n=int(ok.sum()), ours_zero=int(o0.sum()), pgda_psr=int(p1.sum()), both=int((o0 & p1).sum()),
                      ours_only=int((o0 & ~p1).sum()), pgda_only=int((~o0 & p1).sum()),
                      agreement=float(np.mean(o0 == p1)), iou=float((o0 & p1).sum() / max(1, (o0 | p1).sum())))
    (WORK / "pgda_compare.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true")
    a = ap.parse_args()
    if a.fetch:
        fetch()
    pg, valid = extract()
    if (INDEX / "manifest.json").exists() and (INDEX / "static.f32").exists():
        compare(pg, valid)
    else:
        print("index/static.f32 or manifest.json not found yet; re-run once the index is built.")
