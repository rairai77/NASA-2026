"""Globe overlay layers (PSR, PGDA illumination / Earth visibility, Diviner temperatures).

Writes Cesium GeographicTilingScheme PNG tiles (level 0 = 2x1 tiles over lon -180..180, lat 90..-90,
x from lon -180, y = 0 at the north, 256x256) to ../web/public/data/layers/<id>/{z}/{x}/{y}.png plus
layers/manifest.json. Tiles are 8-bit palette PNGs (index 0 = transparent) to keep the total small.

Inputs (pipeline/raw, see validate_pgda.py --fetch / README):
  pgda/AVGVISIB_65S_240M_201608.TIF        average solar illumination (int16, scale 4e-5)
  pgda/AVGVISIB_65S_240M_201608_EARTH.TIF  average Earth visibility   (int16, scale 4e-5)
  pgda/LPSR_65S_240M_201608.TIF            permanent shadow mask (int16 +-20000 -> 0/1)
  diviner/dlre_prp_south.tab               Diviner Polar Resource Product (75-90S, annual avg/max T)

Usage: uv run python layers.py [--only id,id] [--dry]
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from geo import R, south_stereo_fwd, south_stereo_inv

HERE = Path(__file__).parent
RAW = HERE / "raw"
WORK = HERE / "work"
OUT = HERE.parent / "web" / "public" / "data" / "layers"

PGDA = {"illum": "AVGVISIB_65S_240M_201608.TIF", "earthvis": "AVGVISIB_65S_240M_201608_EARTH.TIF",
        "psr": "LPSR_65S_240M_201608.TIF"}
PRP = RAW / "diviner" / "dlre_prp_south.tab"
PRP_GRID = WORK / "diviner_prp_grid.npz"
PRP_CELL = 500.0  # m, raster cell for the triangle-centre point cloud

PGDA_CITE = ("Mazarico, E. et al. (2011), Illumination conditions of the lunar polar regions using LOLA "
             "topography, Icarus 211, 1066-1081, doi:10.1016/j.icarus.2010.10.030. "
             "Data: NASA PGDA product 69 (LOLA, 240 m/px, 65-90S).")
DIV_CITE = ("Paige, D.A. et al. (2010), Diviner Lunar Radiometer observations of cold traps in the Moon's "
            "south polar region, Science 330, 479-482; Williams, J.-P. et al. (2019), Seasonal polar "
            "temperatures on the Moon, JGR Planets 124. Data: LRO Diviner Polar Resource Product "
            "(PDS LRO-L-DLRE-5-PRP-V2.0), annual avg (2 cm depth) / max (surface) temperature.")

# per-level southern-hemisphere north limit: tiles are emitted only if they intersect lat <= limit.
# Chosen to keep the whole set under ~3000 files / ~60 MB (tiles are very wide near the pole).
def lat_limit(layer, z):
    base = layer["lat_min_extent"]  # data's northern edge (deg), e.g. -70
    return {6: -85.0, 7: -87.0}.get(z, base)

LAYERS = [
    dict(id="psr", title="Permanently shadowed regions (PGDA)", units="mask", src="pgda", key="psr",
         kind="mask", color="#22d3ee", alpha=0.6, lat_min_extent=-70.0, max_level=6,
         source="PGDA LOLA permanent shadow map, 240 m", citation=PGDA_CITE, opacity=1.0),
    dict(id="illum", title="Average solar illumination (PGDA)", units="%", src="pgda", key="illum",
         kind="cont", cmap="cividis", alpha=0.75, vmin=0, vmax=100, scale=100.0, lat_min_extent=-70.0,
         max_level=6, source="PGDA LOLA average solar illumination, 18.6-yr mean, 240 m", citation=PGDA_CITE,
         opacity=1.0, transparent_zero=True),
    dict(id="earthvis", title="Average Earth visibility (PGDA)", units="%", src="pgda", key="earthvis",
         kind="cont", cmap="viridis", alpha=0.75, vmin=0, vmax=100, scale=100.0, lat_min_extent=-70.0,
         max_level=6, source="PGDA LOLA average Earth visibility, 18.6-yr mean, 240 m", citation=PGDA_CITE,
         opacity=1.0, transparent_zero=True),
    dict(id="tmax", title="Annual maximum surface temperature (Diviner)", units="K", src="prp", key="temp_max",
         kind="cont", cmap="magma", alpha=0.8, vmin=None, vmax=None, scale=1.0, lat_min_extent=-75.0,
         max_level=5, source="LRO Diviner PRP annual maximum surface temperature, ~500 m", citation=DIV_CITE,
         opacity=1.0),
    dict(id="tavg", title="Annual average temperature at 2 cm depth (Diviner)", units="K", src="prp",
         key="temp_avg", kind="cont", cmap="YlGnBu_r", alpha=0.8, vmin=None, vmax=None, scale=1.0,
         lat_min_extent=-75.0, max_level=5,
         source="LRO Diviner PRP annual average temperature at 2 cm depth, ~500 m", citation=DIV_CITE,
         opacity=1.0),
]

# ---------------------------------------------------------------- sources

class Raster:
    """Array on a south_stereo grid; `sample(lat, lon)` -> float32 with NaN outside / nodata."""
    def __init__(self, arr, x0, y0, pix):
        self.a, self.x0, self.y0, self.pix = arr.astype(np.float32), x0, y0, pix

    def sample(self, lat, lon):
        x, y = south_stereo_fwd(lat, lon)
        col = (x - self.x0) / self.pix - 0.5
        row = (self.y0 - y) / self.pix - 0.5
        return ndimage.map_coordinates(self.a, [row, col], order=1, mode="constant", cval=np.nan,
                                       prefilter=False)

def load_pgda(key):
    import rasterio
    with rasterio.open(RAW / "pgda" / PGDA[key]) as d:
        raw = d.read(1)
        t = d.transform
        assert t.b == 0 and t.d == 0 and abs(t.a) == abs(t.e)
        sc, off = d.scales[0], d.offsets[0]
        nod = d.nodata
        arr = raw.astype(np.float32) * sc + off
        arr[raw == nod] = np.nan
        return Raster(arr, t.c, t.f, t.a)

def parse_prp():
    """Bin Diviner PRP triangle centres onto a PRP_CELL grid (cached)."""
    if PRP_GRID.exists():
        z = np.load(PRP_GRID)
        return {k: Raster(z[k], float(z["x0"]), float(z["y0"]), PRP_CELL) for k in ("temp_avg", "temp_max")}
    raw = np.fromfile(PRP, dtype=np.uint8)
    rows = raw.reshape(-1, 210)[1:]  # first record is the column header
    def col(loc, width):  # PDS locations are 1-based
        return np.ascontiguousarray(rows[:, loc - 1:loc - 1 + width]).view(f"S{width}").ravel().astype(np.float64)
    lon, lat = col(127, 15), col(144, 15)
    avg, mx = col(178, 8), col(188, 8)
    x, y = south_stereo_fwd(lat, lon)
    half = math.ceil(max(np.abs(x).max(), np.abs(y).max()) / PRP_CELL) * PRP_CELL
    n = int(2 * half / PRP_CELL)
    x0, y0 = -half, half
    j = np.clip(((x - x0) / PRP_CELL).astype(int), 0, n - 1)
    i = np.clip(((y0 - y) / PRP_CELL).astype(int), 0, n - 1)
    idx = i * n + j
    cnt = np.bincount(idx, minlength=n * n).astype(np.float64)
    out = {}
    for name, v in (("temp_avg", avg), ("temp_max", mx)):
        ok = v > 0
        s = np.bincount(idx[ok], weights=v[ok], minlength=n * n)
        c = np.bincount(idx[ok], minlength=n * n)
        g = np.where(c > 0, s / np.maximum(c, 1), np.nan).reshape(n, n)
        # fill single-cell holes inside the covered disc by nearest neighbour (<= 2 cells)
        dist, (ii, jj) = ndimage.distance_transform_edt(np.isnan(g), return_indices=True)
        fill = np.isnan(g) & (dist <= 2.0)
        g[fill] = g[ii[fill], jj[fill]]
        out[name] = g.astype(np.float32)
    np.savez_compressed(PRP_GRID, x0=x0, y0=y0, **out)
    return {k: Raster(v, x0, y0, PRP_CELL) for k, v in out.items()}

# ---------------------------------------------------------------- tiles

def tile_bounds(z, x, y):
    d = 180.0 / 2 ** z
    return -180 + x * d, 90 - (y + 1) * d, -180 + (x + 1) * d, 90 - y * d  # w, s, e, n

def tile_list(layer, z):
    d = 180.0 / 2 ** z
    lim = lat_limit(layer, z)
    ys = [y for y in range(2 ** z) if 90 - (y + 1) * d < lim]  # tile south edge below the limit
    return [(x, y) for y in ys for x in range(2 ** (z + 1))]

def palette(layer):
    """256-entry RGB palette + alpha bytes; index 0 transparent."""
    pal = np.zeros((256, 3), np.uint8)
    a = np.zeros(256, np.uint8)
    if layer["kind"] == "mask":
        rgb = tuple(int(layer["color"][i:i + 2], 16) for i in (1, 3, 5))
        pal[1] = rgb
        a[1] = round(layer["alpha"] * 255)
    else:
        import matplotlib
        cm = matplotlib.colormaps[layer["cmap"]]
        cols = (cm(np.linspace(0, 1, 255))[:, :3] * 255).round().astype(np.uint8)
        pal[1:] = cols
        a[1:] = round(layer["alpha"] * 255)
    return pal, a

def render_tile(layer, src, z, x, y, level_scale):
    w, s, e, n = tile_bounds(z, x, y)
    px = (np.arange(256) + 0.5) / 256
    lon = w + px * (e - w)
    lat = n - px * (n - s)
    LON, LAT = np.meshgrid(lon, lat)
    v = src.sample(LAT, LON) * level_scale
    ok = np.isfinite(v) & (LAT <= lat_limit(layer, z))
    idx = np.zeros(v.shape, np.uint8)
    if layer["kind"] == "mask":
        idx[ok & (v >= 0.5)] = 1
    else:
        if layer.get("transparent_zero"):
            ok &= v > 1e-6 * layer["scale"]
        t = np.clip((v - layer["vmin"]) / (layer["vmax"] - layer["vmin"]), 0, 1)
        idx[ok] = (1 + np.round(t[ok] * 254)).astype(np.uint8)
    return idx

def write_png(idx, pal, alpha, path):
    im = Image.fromarray(idx, mode="P")
    im.putpalette(pal.ravel().tolist())
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, optimize=True, transparency=bytes(alpha))

def run(only, dry):
    OUT.mkdir(parents=True, exist_ok=True)
    prp = None
    manifest, total_n, total_b = [], 0, 0
    for L in LAYERS:
        if only and L["id"] not in only:
            continue
        if L["src"] == "pgda":
            src = load_pgda(L["key"])
        else:
            prp = prp or parse_prp()
            src = prp[L["key"]]
        if L["kind"] == "cont" and L["vmin"] is None:  # temperature range from data (rounded to 10 K)
            q = np.nanpercentile(src.a[np.isfinite(src.a)][::7], [0.5, 99.5])
            L["vmin"], L["vmax"] = float(math.floor(q[0] / 10) * 10), float(math.ceil(q[1] / 10) * 10)
        pal, alpha = palette(L)
        n_files, n_bytes = 0, 0
        for z in range(0, L["max_level"] + 1):
            for x, y in tile_list(L, z):
                idx = render_tile(L, src, z, x, y, L["scale"] if L["kind"] == "cont" else 1.0)
                if not idx.any():
                    continue
                n_files += 1
                if not dry:
                    p = OUT / L["id"] / str(z) / str(x) / f"{y}.png"
                    write_png(idx, pal, alpha, p)
                    n_bytes += p.stat().st_size
        print(f"{L['id']:9s} levels 0..{L['max_level']}  {n_files:5d} tiles  {n_bytes/1e6:6.1f} MB", flush=True)
        total_n += n_files; total_b += n_bytes
        stops = []
        if L["kind"] == "mask":
            stops = [[1, L["color"]]]
        else:
            import matplotlib
            cm = matplotlib.colormaps[L["cmap"]]
            for f in np.linspace(0, 1, 6):
                r, g, b = (np.array(cm(f)[:3]) * 255).round().astype(int)
                stops.append([round(L["vmin"] + f * (L["vmax"] - L["vmin"]), 1), f"#{r:02x}{g:02x}{b:02x}"])
        manifest.append({
            "id": L["id"], "title": L["title"], "units": L["units"], "source": L["source"],
            "citation": L["citation"], "maxLevel": L["max_level"],
            "rectangle": [-180, -90, 180, L["lat_min_extent"]],
            "path": f"layers/{L['id']}/{{z}}/{{x}}/{{y}}.png",
            "legend": {"min": L.get("vmin", 0) if L["kind"] == "cont" else 0,
                       "max": L.get("vmax", 1) if L["kind"] == "cont" else 1, "stops": stops},
            "opacity": L["opacity"],
            "tileLatLimits": {str(z): lat_limit(L, z) for z in range(0, L["max_level"] + 1)},
        })
    print(f"TOTAL {total_n} tiles, {total_b/1e6:.1f} MB")
    if not dry and not only:
        (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    run(set(filter(None, a.only.split(","))), a.dry)
