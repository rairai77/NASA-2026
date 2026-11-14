"""Region index (CONTRACTS §3): web/public/data/index/{manifest.json,static.f32,horizons/b*.i16.gz,months/*.u64.gz}.

Needs the `lunar_engine` Python module. Horizon grid cached in work/horizons.npy; month bitsets cached in work/months/.
"""
import calendar, datetime as dt, gzip, json, sys, time
from pathlib import Path
import numpy as np
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import geo  # noqa: E402
from reference.terrain import Terrain  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "index"
WORK = Path(__file__).resolve().parent / "work"
NX = NY = 304
CELL = 1000.0
X0, Y0 = -152000.0, 152000.0
MAX_LAT = -85.0
H = 2.0
N_AZ = 360
STEP_S = 10800
ROWS_PER_BAND = 38
WORDS = 4
MONTHS = [(y, m) for y in range(2026, 2031) for m in range(1, 13)]
COLUMNS = ["lat", "lon", "elev_m", "slope_deg", "sun_frac_5yr", "earth_frac_5yr", "psr_dist_km", "fault_dist_km"]

def log(*a):
    print(f"[index {time.strftime('%H:%M:%S')}]", *a, flush=True)

def month_t0(y, m):
    return int(dt.datetime(y, m, 1, tzinfo=dt.timezone.utc).timestamp()), calendar.monthrange(y, m)[1] * 8

def popcount(a, ncell):
    """Per-cell popcount of a flat u64 array [ncell*WORDS]."""
    return np.unpackbits(np.ascontiguousarray(a).view(np.uint8).reshape(ncell, WORDS * 8), axis=1).sum(1, dtype=np.int64)

def slope_cells(T):
    """Mean slope (deg) of the s0 20 m grid over each 1 km cell (50x50 pixel block), nan-aware."""
    lv = T.levels["s0"]
    ts, nt = T.ts, lv["tiles_x"]
    H0 = np.full((lv["height"], lv["width"]), np.nan, np.float32)
    for ty in range(lv["tiles_y"]):
        for tx in range(lv["tiles_x"]):
            t = T.tile("s0", tx, ty)
            if t is None:
                continue
            b = t.astype(np.float32) * T.m["height_scale"]
            b[t == T.m["nodata"]] = np.nan
            h, w = min(ts, lv["height"] - ty * ts), min(ts, lv["width"] - tx * ts)
            H0[ty * ts:ty * ts + h, tx * ts:tx * ts + w] = b[:h, :w]
        T.cache.clear()
    gy, gx = np.gradient(H0, lv["pixel_m"])
    S = np.degrees(np.arctan(np.hypot(gx, gy)))
    del H0, gx, gy
    # s0 origin is 320 m (16 px) inside the cell grid origin: pad 16 px each side -> 15200 = 304*50
    off = int(round((lv["x0"] - X0) / lv["pixel_m"]))
    assert off == 16 and lv["y0"] - Y0 == -320
    P = np.full((NY * 50, NX * 50), np.nan, np.float32)
    P[off:off + S.shape[0], off:off + S.shape[1]] = S
    del S
    B = P.reshape(NY, 50, NX, 50)
    good = np.isfinite(B)
    cnt = good.sum((1, 3))
    tot = np.where(good, B, 0).sum((1, 3), dtype=np.float64)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(cnt > 0, tot / cnt, np.nan).astype(np.float32)

def fault_dist_km(x, y):
    g = json.loads((ROOT / "data-src" / "faults.geojson").read_text())
    segs = []
    for f in g["features"]:
        geom = f["geometry"]
        pts = geom["coordinates"] if geom["type"] == "LineString" else [geom["coordinates"]]
        pts = [p for p in pts]
        if not any(p[1] < -60 for p in pts):
            continue
        lon = np.array([p[0] for p in pts]); lat = np.array([p[1] for p in pts])
        px, py = geo.south_stereo_fwd(lat, lon)
        if len(px) == 1:
            segs.append((px[0], py[0], px[0], py[0]))
        for k in range(len(px) - 1):
            segs.append((px[k], py[k], px[k + 1], py[k + 1]))
    if not segs:
        return np.full(x.shape, np.nan), 0
    d = np.full(x.shape, np.inf)
    for ax, ay, bx, by in segs:
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy
        t = np.clip(((x - ax) * vx + (y - ay) * vy) / L2, 0, 1) if L2 > 0 else 0.0
        d = np.minimum(d, np.hypot(x - (ax + t * vx), y - (ay + t * vy)))
    return d / 1000.0, len(segs)

def main():
    import lunar_engine
    t_all = time.time()
    eng = lunar_engine.Engine()
    eng.load_ephemeris_files(str(DATA / "ephem" / "ephem.json"), str(DATA / "ephem" / "ephem.f32"))
    t = time.time(); n = eng.load_terrain_dir(str(DATA)); log(f"loaded {n} terrain tiles in {time.time()-t:.1f}s")
    WORK.mkdir(exist_ok=True); (WORK / "months").mkdir(exist_ok=True)
    (OUT / "horizons").mkdir(parents=True, exist_ok=True); (OUT / "months").mkdir(exist_ok=True)

    # cell geometry
    jj, ii = np.meshgrid(np.arange(NX), np.arange(NY))
    cx, cy = X0 + (jj + 0.5) * CELL, Y0 - (ii + 0.5) * CELL
    lat, lon = geo.south_stereo_inv(cx, cy)
    valid = lat <= MAX_LAT
    log(f"valid cells {valid.sum()} / {NX*NY}")

    # horizons
    hp = WORK / "horizons.npy"
    if hp.exists():
        hz = np.load(hp); log("horizons from cache")
    else:
        t = time.time()
        hz = eng.grid_horizons(NX, NY, X0, Y0, CELL, N_AZ, H, MAX_LAT)
        log(f"grid_horizons {time.time()-t:.1f}s shape {hz.shape}")
        np.save(hp, hz)
    hz = np.ascontiguousarray(hz, dtype=np.int16)
    nvalid_hz = (hz[..., 0] != -32768).sum()
    log(f"cells with horizon data {nvalid_hz}")
    bands = []
    for k, r0 in enumerate(range(0, NY, ROWS_PER_BAND)):
        p = OUT / "horizons" / f"b{k}.i16.gz"
        p.write_bytes(gzip.compress(hz[r0:r0 + ROWS_PER_BAND].astype("<i2").tobytes(), 6, mtime=0))
        bands.append(f"index/horizons/b{k}.i16.gz")

    # elevation at cell centers
    elev = np.full(NX * NY, np.nan, np.float32)
    for c in np.flatnonzero(valid.ravel()):
        e = eng.site_elevation(float(lat.ravel()[c]), float(lon.ravel()[c]))
        if e is not None:
            elev[c] = e
    elev_for_bits = np.where(np.isfinite(elev), elev, 0).astype(np.float32)

    # month bitsets
    ncell = NX * NY
    sun_cnt = np.zeros(ncell, np.int64); earth_cnt = np.zeros(ncell, np.int64); total = 0
    months = []
    t = time.time()
    for y, m in MONTHS:
        t0, ns = month_t0(y, m)
        name = f"{y}-{m:02d}"
        cp = WORK / "months" / f"{name}.npz"
        if cp.exists():
            z = np.load(cp); s, e = z["s"], z["e"]
        else:
            s, e = eng.grid_bitsets(hz, float(t0), ns, float(STEP_S), H, X0, Y0, CELL, elev_for_bits)
            np.savez(cp, s=s, e=e)
        assert s.size == ncell * WORDS and e.size == ncell * WORDS, (s.size, e.size)
        vm = np.repeat(valid.ravel(), WORDS)
        s = np.where(vm, s, 0).astype("<u8"); e = np.where(vm, e, 0).astype("<u8")
        (OUT / "months" / f"{name}.u64.gz").write_bytes(gzip.compress(s.tobytes() + e.tobytes(), 6, mtime=0))
        sun_cnt += popcount(s, ncell)
        earth_cnt += popcount(e, ncell)
        total += ns
        months.append({"month": name, "file": f"index/months/{name}.u64.gz", "t0_unix": t0, "n_steps": ns, "words": WORDS})
    log(f"month bitsets {time.time()-t:.1f}s total steps {total}")
    sun_frac = (sun_cnt / total).astype(np.float32).reshape(NY, NX)
    earth_frac = (earth_cnt / total).astype(np.float32).reshape(NY, NX)

    # slope
    t = time.time()
    slope = slope_cells(Terrain(DATA, levels=["s0"])); log(f"slope {time.time()-t:.1f}s")

    # psr distance
    psr = valid & (sun_frac == 0)
    if psr.any():
        psr_d = (ndimage.distance_transform_edt(~psr) * CELL / 1000.0).astype(np.float32)
    else:
        psr_d = np.full((NY, NX), np.nan, np.float32)
    fd, nseg = fault_dist_km(cx, cy); log(f"fault segments (lat<-60): {nseg}")

    cols = [lat, lon, elev.reshape(NY, NX), slope, sun_frac, earth_frac, psr_d, fd]
    with open(OUT / "static.f32", "wb") as f:
        for c in cols:
            a = np.where(valid, c, np.nan).astype("<f4")
            f.write(a.tobytes())

    manifest = {
        "grid": {"proj": "south_stereo", "cell_m": 1000, "x0": X0, "y0": Y0, "nx": NX, "ny": NY, "max_lat": MAX_LAT},
        "height_m": 2, "n_az": N_AZ, "step_s": STEP_S,
        "static": {"file": "index/static.f32", "columns": COLUMNS},
        "horizons": {"rows_per_band": ROWS_PER_BAND, "bands": bands, "scale_deg": 0.01},
        "months": months,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))

    # sanity
    v = valid
    log(f"valid cells with sun_frac_5yr == 0: {(sun_frac[v] == 0).mean()*100:.2f}% ({psr.sum()} cells)")
    log(f"sun_frac range {np.nanmin(sun_frac[v]):.3f}..{sun_frac[v].max():.3f}; earth_frac range {earth_frac[v].min():.3f}..{earth_frac[v].max():.3f}; "
        f"earth_frac==0: {(earth_frac[v]==0).mean()*100:.1f}%, >0.5: {(earth_frac[v]>0.5).mean()*100:.1f}%")
    log("top-10 sun_frac_5yr cells:")
    sf = np.where(v, sun_frac, -1).ravel()
    for c in np.argsort(-sf)[:10]:
        log(f"  cell {c} lat {lat.ravel()[c]:.3f} lon {lon.ravel()[c]:.2f} sun {sf[c]:.3f} earth {earth_frac.ravel()[c]:.3f} elev {elev[c]:.0f} slope {slope.ravel()[c]:.1f}")
    log(f"slope mean {np.nanmean(slope[v]):.1f} nan {np.isnan(slope[v]).sum()}; elev nan {np.isnan(elev[v.ravel()]).sum()}; psr_d max {np.nanmax(psr_d[v]):.1f} km; fault_d min/max {np.nanmin(fd[v]):.1f}/{np.nanmax(fd[v]):.1f} km")
    log(f"done in {time.time()-t_all:.1f}s")

if __name__ == "__main__":
    main()
