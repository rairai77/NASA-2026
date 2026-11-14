"""Cut LOLA GDR DEMs into the terrain tile pyramid (CONTRACTS §2)."""
import gzip, json, re, sys
from multiprocessing import Pool
from pathlib import Path
import numpy as np

HERE = Path(__file__).parent
RAW = HERE / "raw" / "lola"
OUT = HERE.parent / "web" / "public" / "data" / "terrain"
TS = 256
NODATA = -32768
MISSING_RADIUS_M = 700e3

# id, source stem, projection, kind params
LEVELS = [
    ("s0", "ldem_85s_20m", "south_stereo", {"pixel_m": 20}),
    ("s1", "ldem_80s_80m", "south_stereo", {"pixel_m": 80}),
    ("s2", "ldem_60s_240m", "south_stereo", {"pixel_m": 240, "max_dist_m": MISSING_RADIUS_M}),
    ("g0", "ldem_64", "equirect", {"ppd": 64}),
    ("g1", "ldem_16", "equirect", {"ppd": 16}),
    ("g2", "ldem_4", "equirect", {"ppd": 4}),
]

def parse_lbl(path):
    """Parse the PDS3 label into a flat dict of KEY -> value (first occurrence wins)."""
    d = {}
    for line in path.read_text(errors="replace").splitlines():
        m = re.match(r"\s*\^?([A-Z_0-9]+)\s*=\s*(.+?)\s*$", line)
        if m and m.group(1) not in d:
            d[m.group(1)] = m.group(2).split("<")[0].strip().strip('"').strip("'")
    return d

def level_geometry(lid, stem, proj, params):
    lbl = parse_lbl(RAW / f"{stem}.lbl")
    assert lbl["SAMPLE_TYPE"] == "LSB_INTEGER" and int(lbl["SAMPLE_BITS"]) == 16, lbl["SAMPLE_TYPE"]
    assert float(lbl["SCALING_FACTOR"]) == 0.5 and float(lbl["OFFSET"]) == 1737400.0
    assert float(lbl["A_AXIS_RADIUS"]) == 1737.4 and float(lbl["C_AXIS_RADIUS"]) == 1737.4
    h, w = int(lbl["LINES"]), int(lbl["LINE_SAMPLES"])
    assert (RAW / f"{stem}.img").stat().st_size == h * w * 2
    lv = {"id": lid, "proj": proj}
    if proj == "south_stereo":
        px = float(lbl["MAP_SCALE"]); assert px == params["pixel_m"]
        assert lbl["MAP_PROJECTION_TYPE"] == "POLAR STEREOGRAPHIC" and float(lbl["CENTER_LATITUDE"]) == -90 \
            and float(lbl["CENTER_LONGITUDE"]) == 0 and float(lbl["MAP_PROJECTION_ROTATION"]) == 0
        # PDS offsets are the 0-based pixel-center coordinate of the projection origin (pixel registration):
        # origin edge coordinate = offset + 0.5, which must equal the image center for an even-sized image.
        lo, so = float(lbl["LINE_PROJECTION_OFFSET"]), float(lbl["SAMPLE_PROJECTION_OFFSET"])
        x0 = -(so + 0.5) * px; y0 = (lo + 0.5) * px
        assert x0 == -w * px / 2 and y0 == h * px / 2, (x0, y0)
        lv.update(pixel_m=int(px), x0=int(x0), y0=int(y0))
    else:
        ppd = float(lbl["MAP_RESOLUTION"]); assert ppd == params["ppd"]
        assert lbl["MAP_PROJECTION_TYPE"] == "SIMPLE CYLINDRICAL"
        assert float(lbl["WESTERNMOST_LONGITUDE"]) == 0 and float(lbl["EASTERNMOST_LONGITUDE"]) == 360
        assert float(lbl["MAXIMUM_LATITUDE"]) == 90 and float(lbl["MINIMUM_LATITUDE"]) == -90
        assert w == 360 * ppd and h == 180 * ppd
        assert float(lbl["SAMPLE_PROJECTION_OFFSET"]) + 0.5 == w / 2 and float(lbl["LINE_PROJECTION_OFFSET"]) + 0.5 == h / 2
        lv.update(ppd=int(ppd), lon_min=0, lat_max=90)
    lv.update(width=w, height=h, tiles_x=-(-w // TS), tiles_y=-(-h // TS),
              path=f"terrain/{lid}/{{ty}}/{{tx}}.i16.gz", source=stem.upper())
    return lv

def tile_center_dist_m(lv, tx, ty):
    cx = lv["x0"] + (tx + 0.5) * TS * lv["pixel_m"]
    cy = lv["y0"] - (ty + 0.5) * TS * lv["pixel_m"]
    return float(np.hypot(cx, cy))

def work(args):
    lid, stem, h, w, ty, txs = args
    img = np.memmap(RAW / f"{stem}.img", dtype="<i2", mode="r", shape=(h, w))
    done = []
    for tx in txs:
        t = np.full((TS, TS), NODATA, dtype="<i2")
        r0, c0 = ty * TS, tx * TS
        blk = img[r0:r0 + TS, c0:c0 + TS]
        t[:blk.shape[0], :blk.shape[1]] = blk
        if (t == NODATA).all():
            done.append((tx, ty, 0)); continue
        p = OUT / lid / str(ty) / f"{tx}.i16.gz"
        p.parent.mkdir(parents=True, exist_ok=True)
        # mtime=0 -> deterministic output
        with open(p, "wb") as f, gzip.GzipFile(fileobj=f, mode="wb", compresslevel=6, mtime=0) as g:
            g.write(t.tobytes())
        done.append((tx, ty, p.stat().st_size))
    return done

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    levels = []
    total_files = total_bytes = 0
    with Pool(4) as pool:
        for lid, stem, proj, params in LEVELS:
            lv = level_geometry(lid, stem, proj, params)
            print(lv, flush=True)
            missing = set()
            jobs = []
            for ty in range(lv["tiles_y"]):
                txs = []
                for tx in range(lv["tiles_x"]):
                    if "max_dist_m" in params and tile_center_dist_m(lv, tx, ty) > params["max_dist_m"]:
                        missing.add((tx, ty))
                    else:
                        txs.append(tx)
                if txs:
                    jobs.append((lid, stem, lv["height"], lv["width"], ty, txs))
            # remove stale tiles of this level so the dir matches the manifest
            for p in (OUT / lid).glob("*/*.i16.gz") if (OUT / lid).exists() else []:
                p.unlink()
            sizes = []
            for res in pool.imap_unordered(work, jobs):
                for tx, ty, sz in res:
                    if sz == 0: missing.add((tx, ty))
                    else: sizes.append(sz)
            lv["missing"] = [f"{tx},{ty}" for tx, ty in sorted(missing, key=lambda t: (t[1], t[0]))]
            levels.append(lv)
            total_files += len(sizes); total_bytes += sum(sizes)
            print(f"{lid}: {len(sizes)} tiles, {sum(sizes)/1e6:.1f} MB, max {max(sizes)/1e3:.0f} KB, missing {len(missing)}", flush=True)
    manifest = {"tile_size": TS, "height_scale": 0.5, "nodata": NODATA, "radius_m": 1737400, "levels": levels}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"TOTAL {total_files} files, {total_bytes/1e6:.1f} MB")

if __name__ == "__main__":
    main()
