"""Coarse global region index (~10 km equirect cells, 6 h steps) for searches outside the polar cap.

Writes web/public/data/global/{manifest.json, static.f32, horizons/b*.i16.gz, months/*.u64.gz}; same layout as
index/ (CONTRACTS §3) with grid {"proj": "equirect", "ppd", "lat_max", "lon_min", "nx", "ny"}.
Uses only the global terrain levels (g0/g1/g2) with a 150 km horizon, 72 azimuths. Needs the `lunar_engine` module.
Caches in work/global/.
"""
import calendar, datetime as dt, gzip, json, time
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "global"
WORK = Path(__file__).resolve().parent / "work" / "global"
PPD = 3
NX, NY = 360 * PPD, 180 * PPD
H = 2.0
N_AZ = 72
MAX_DIST_KM = 150.0
STEP_S = 21600
ROWS_PER_BAND = 90
MONTHS = [(y, m) for y in range(2026, 2031) for m in range(1, 13)]
COLUMNS = ["lat", "lon", "elev_m", "slope_deg", "sun_frac_5yr", "earth_frac_5yr"]
R = 1737400.0

def log(*a):
    print(f"[global {time.strftime('%H:%M:%S')}]", *a, flush=True)

def month_t0(y, m):
    return int(dt.datetime(y, m, 1, tzinfo=dt.timezone.utc).timestamp()), calendar.monthrange(y, m)[1] * 4

def popcount(a, ncell, words):
    return np.unpackbits(np.ascontiguousarray(a).view(np.uint8).reshape(ncell, words * 8), axis=1).sum(1, dtype=np.int64)

def main():
    import lunar_engine
    eng = lunar_engine.Engine()
    eng.load_ephemeris_files(str(DATA / "ephem" / "ephem.json"), str(DATA / "ephem" / "ephem.f32"))
    t = time.time(); n = eng.load_terrain_dir(str(DATA), ["g0", "g1", "g2"]); log(f"loaded {n} global terrain tiles in {time.time()-t:.1f}s")
    WORK.mkdir(parents=True, exist_ok=True); (OUT / "horizons").mkdir(parents=True, exist_ok=True); (OUT / "months").mkdir(exist_ok=True)
    ii, jj = np.meshgrid(np.arange(NY), np.arange(NX), indexing="ij")
    lat = (90 - (ii + 0.5) / PPD).astype(np.float64); lon = (-180 + (jj + 0.5) / PPD).astype(np.float64)
    ncell = NX * NY

    hp = WORK / "horizons.npy"
    if hp.exists():
        hz = np.load(hp); log("horizons from cache")
    else:
        t = time.time(); hz = eng.global_grid_horizons(float(PPD), N_AZ, H, MAX_DIST_KM); log(f"global_grid_horizons {time.time()-t:.1f}s {hz.shape}")
        np.save(hp, hz)
    hz = np.ascontiguousarray(hz, dtype=np.int16)
    bands = []
    for k, r0 in enumerate(range(0, NY, ROWS_PER_BAND)):
        (OUT / "horizons" / f"b{k}.i16.gz").write_bytes(gzip.compress(hz[r0:r0 + ROWS_PER_BAND].astype("<i2").tobytes(), 6, mtime=0))
        bands.append(f"global/horizons/b{k}.i16.gz")

    elev = eng.sample_points(lat.ravel(), lon.ravel(), None).astype(np.float32)
    valid = np.isfinite(elev) & (hz[..., 0].ravel() != -32768)
    log(f"valid cells {valid.sum()} / {ncell}")
    elev_bits = np.where(np.isfinite(elev), elev, 0).astype(np.float32)

    # slope over a +-1 g0 pixel baseline (~0.9 km)
    d = 1.0 / 64
    la, lo = lat.ravel(), lon.ravel()
    cosl = np.maximum(np.cos(np.radians(la)), 0.02)
    dlon = np.minimum(d / cosl, 2.0)
    h = lambda a, b: eng.sample_points(a, b, "g0")
    dzdy = (h(np.minimum(la + d, 89.99), lo) - h(np.maximum(la - d, -89.99), lo)) / (R * np.radians(2 * d))
    dzdx = (h(la, lo + dlon) - h(la, lo - dlon)) / (R * np.radians(2 * dlon) * cosl)
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy))).astype(np.float32)

    sun_cnt = np.zeros(ncell, np.int64); earth_cnt = np.zeros(ncell, np.int64); total = 0
    months = []
    t = time.time()
    for y, m in MONTHS:
        t0, ns = month_t0(y, m)
        name = f"{y}-{m:02d}"; words = (ns + 63) // 64
        cp = WORK / f"{name}.npz"
        if cp.exists():
            z = np.load(cp); s, e = z["s"], z["e"]
        else:
            s, e = eng.global_grid_bitsets(hz, float(t0), ns, float(STEP_S), H, float(PPD), elev_bits)
            np.savez(cp, s=s, e=e)
        vm = np.repeat(valid, words)
        s = np.where(vm, s, 0).astype("<u8"); e = np.where(vm, e, 0).astype("<u8")
        (OUT / "months" / f"{name}.u64.gz").write_bytes(gzip.compress(s.tobytes() + e.tobytes(), 6, mtime=0))
        sun_cnt += popcount(s, ncell, words); earth_cnt += popcount(e, ncell, words); total += ns
        months.append({"month": name, "file": f"global/months/{name}.u64.gz", "t0_unix": t0, "n_steps": ns, "words": words})
    log(f"month bitsets {time.time()-t:.1f}s")
    sun_frac = (sun_cnt / total).astype(np.float32); earth_frac = (earth_cnt / total).astype(np.float32)
    cols = [la, lo, np.where(np.isfinite(elev), elev, np.nan), slope, sun_frac, earth_frac]
    with open(OUT / "static.f32", "wb") as f:
        for c in cols:
            f.write(np.where(valid, c, np.nan).astype("<f4").tobytes())
    manifest = {"grid": {"proj": "equirect", "ppd": PPD, "lat_max": 90, "lon_min": -180, "nx": NX, "ny": NY},
                "height_m": H, "n_az": N_AZ, "step_s": STEP_S, "max_dist_km": MAX_DIST_KM,
                "static": {"file": "global/static.f32", "columns": COLUMNS},
                "horizons": {"rows_per_band": ROWS_PER_BAND, "bands": bands, "scale_deg": 0.01}, "months": months}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    big = max(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    log(f"done; files {sum(1 for p in OUT.rglob('*') if p.is_file())}, largest {big/2**20:.1f} MiB; "
        f"sun_frac mean {np.nanmean(sun_frac[valid]):.3f} earth_frac mean {earth_frac[valid].mean():.3f}")

if __name__ == "__main__":
    main()
