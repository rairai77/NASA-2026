"""numpy reference terrain sampler (CONTRACTS §2): bilinear at pixel centers, nodata fallback across levels.

Usage: `python -m reference.terrain` runs the sanity checks (from pipeline/).
"""
import gzip, json, sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import geo  # noqa: E402

DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
ORDER_POLAR = ["s0", "s1", "s2"]
ORDER_GLOBAL = ["g0", "g1", "g2"]

class Terrain:
    def __init__(self, data_dir=DATA, levels=None):
        self.dir = Path(data_dir)
        self.m = json.loads((self.dir / "terrain" / "manifest.json").read_text())
        self.ts = self.m["tile_size"]
        self.levels = {l["id"]: l for l in self.m["levels"]}
        self.use = levels  # optional restriction of level ids
        self.cache = {}
        for l in self.levels.values():
            l["_missing"] = set(l["missing"])

    def tile(self, lid, tx, ty):
        k = (lid, tx, ty)
        if k not in self.cache:
            lv = self.levels[lid]
            if f"{tx},{ty}" in lv["_missing"]:
                self.cache[k] = None
            else:
                p = self.dir / lv["path"].format(tx=tx, ty=ty)
                self.cache[k] = (np.frombuffer(gzip.decompress(p.read_bytes()), "<i2").reshape(self.ts, self.ts)
                                 if p.exists() else None)
        return self.cache[k]

    def pix(self, lid, i, j):
        """Raw DN at integer pixel (i,j) or None if absent/nodata/out of range."""
        lv = self.levels[lid]
        if not (0 <= i < lv["height"] and 0 <= j < lv["width"]):
            return None
        t = self.tile(lid, j // self.ts, i // self.ts)
        if t is None:
            return None
        v = int(t[i % self.ts, j % self.ts])
        return None if v == self.m["nodata"] else v

    def sample_level(self, lid, lat, lon):
        """Height in meters or None. Longitude wraps for equirect; rows are NOT clamped at the poles
        (neighbour outside the grid => invalid), exactly as the contract's 'any neighbour absent' rule."""
        lv = self.levels[lid]
        if lv["proj"] == "south_stereo":
            r, c = geo.stereo_pixel(lv, lat, lon)
        else:
            r, c = geo.equirect_pixel(lv, lat, lon)
        r, c = float(r), float(c)
        i0, j0 = int(np.floor(r)), int(np.floor(c))
        fr, fc = r - i0, c - j0
        acc = 0.0
        for di, wi in ((0, 1 - fr), (1, fr)):
            for dj, wj in ((0, 1 - fc), (1, fc)):
                j = j0 + dj
                if lv["proj"] == "equirect":
                    j %= lv["width"]
                v = self.pix(lid, i0 + di, j)
                if v is None:
                    return None
                acc += wi * wj * v
        return acc * self.m["height_scale"]

    def sample(self, lat, lon, with_level=False):
        order = (ORDER_POLAR if lat < -60 else []) + ORDER_GLOBAL
        if self.use:
            order = [o for o in order if o in self.use]
        for lid in order:
            h = self.sample_level(lid, lat, lon)
            if h is not None:
                return (h, lid) if with_level else h
        return (None, None) if with_level else None

def _check():
    T = Terrain()
    print("south pole       ", {l: T.sample_level(l, -90.0, 0.0) for l in ["s0", "s1", "s2", "g0", "g1", "g2"]})
    print("Shackleton floor ", {l: T.sample_level(l, -89.67, 129.8) for l in ["s0", "s1", "s2", "g0", "g1", "g2"]})
    print("Apollo 11        ", {l: T.sample_level(l, 0.67416, 23.47314) for l in ["g0", "g1", "g2"]})
    print("Apollo 17 (20.19N,30.77E)", {l: T.sample_level(l, 20.19, 30.77) for l in ["g0", "g1", "g2"]})
    print("Malapert ~ (-85.99, 2.84)", {l: T.sample_level(l, -85.99, 2.84) for l in ["s0", "s1", "s2", "g0", "g1"]})
    print("Tycho (-43.3, -11.2)", T.sample(-43.3, -11.2, True))
    print("Mons Huygens-ish/East limb (0, 359.9)", T.sample(0, 359.9, True), "wrap check", T.sample(0, -0.1, True))
    # level agreement over a polar disc
    rng = np.random.default_rng(0)
    for a, b in (("s0", "s1"), ("s1", "s2"), ("s1", "g0"), ("g0", "g1")):
        d = []
        for _ in range(400):
            lat = -90 + 4.5 * np.sqrt(rng.random()) if a == "s0" else (-90 + 9.5 * np.sqrt(rng.random()))
            lon = rng.uniform(-180, 180)
            ha, hb = T.sample_level(a, lat, lon), T.sample_level(b, lat, lon)
            if ha is not None and hb is not None:
                d.append(ha - hb)
        d = np.array(d)
        print(f"{a}-{b}: n={len(d)} mean {d.mean():.1f} m, rms {np.sqrt((d**2).mean()):.1f} m, max |d| {abs(d).max():.1f} m")

if __name__ == "__main__":
    _check()
