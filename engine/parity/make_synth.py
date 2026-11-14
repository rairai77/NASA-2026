"""Build a small synthetic data dir (terrain pyramid with a few Gaussian
mountains, ephemeris, tiny polar index) for exercising the engine end to end.

    python make_synth.py OUT_DIR            # needs numpy and the lunar_engine wheel
Then:  node check.mjs OUT_DIR
"""
import gzip, json, os, sys
import numpy as np
import lunar_engine as le

out = sys.argv[1]
R = 1737400.0
os.makedirs(out + "/terrain", exist_ok=True)
os.makedirs(out + "/ephem", exist_ok=True)
os.makedirs(out + "/index/months", exist_ok=True)
os.makedirs(out + "/index/horizons", exist_ok=True)

MOUNTS = [(0, 10000, 1500, 3000), (-20000, -15000, 2500, 4000), (30000, 5000, 900, 2000)]

def height(x, y):
    z = np.zeros_like(x)
    for mx, my, h, s in MOUNTS:
        z += h * np.exp(-((x - mx) ** 2 + (y - my) ** 2) / (2 * s * s))
    return z

zero_raw = np.zeros(256 * 256, "<i2").tobytes()
zero = gzip.compress(zero_raw, 1)

def stereo(id, pm, w):
    half = w * pm / 2
    t = -(-w // 256)
    return dict(id=id, proj="south_stereo", pixel_m=pm, x0=-half, y0=half, width=w, height=w, tiles_x=t, tiles_y=t,
                path=f"terrain/{id}/{{ty}}/{{tx}}.i16.gz", missing=[], source="synthetic")

def eq(id, ppd):
    w, h = 360 * ppd, 180 * ppd
    return dict(id=id, proj="equirect", ppd=ppd, lon_min=0, lat_max=90, width=w, height=h, tiles_x=-(-w // 256),
                tiles_y=-(-h // 256), path=f"terrain/{id}/{{ty}}/{{tx}}.i16.gz", missing=[], source="synthetic")

levels = [stereo("s0", 20, 15168), stereo("s1", 80, 3792), stereo("s2", 240, 1264), eq("g0", 64), eq("g1", 16), eq("g2", 4)]
json.dump(dict(tile_size=256, height_scale=0.5, nodata=-32768, radius_m=1737400, levels=levels),
          open(out + "/terrain/manifest.json", "w"))
for l in levels:
    for ty in range(l["tiles_y"]):
        d = f"{out}/terrain/{l['id']}/{ty}"
        os.makedirs(d, exist_ok=True)
        for tx in range(l["tiles_x"]):
            raw = None
            if l["proj"] == "south_stereo":
                pm, half = l["pixel_m"], l["width"] * l["pixel_m"] / 2
                cx = -half + (tx + 0.5) * 256 * pm
                cy = half - (ty + 0.5) * 256 * pm
                near = any(np.hypot(cx - mx, cy - my) < 4.5 * s + 256 * pm for mx, my, h, s in MOUNTS)
                if near:
                    j = np.arange(256) + tx * 256
                    i = np.arange(256) + ty * 256
                    X, Y = np.meshgrid(-half + (j + 0.5) * pm, half - (i + 0.5) * pm)
                    raw = gzip.compress((height(X, Y) / 0.5).round().astype("<i2").tobytes(), 1)
            open(f"{d}/{tx}.i16.gz", "wb").write(raw or zero)

# ephemeris: Sun circles the Moon in 27.32 d, Earth near +x with libration
t0, N = 1767225600, 35040
t = np.arange(N) * 900.0
ang = -2 * np.pi / (27.321661 * 86400) * t
sun = np.stack([1.496e8 * np.cos(ang), 1.496e8 * np.sin(ang), 1.496e8 * np.sin(np.radians(1.54)) * np.ones(N)], 1)
earth = np.stack([384400 * np.ones(N), 384400 * 0.08 * np.sin(2 * np.pi * t / (27.55 * 86400)),
                  384400 * 0.07 * np.sin(2 * np.pi * t / (27.21 * 86400))], 1)
np.concatenate([sun, earth], 1).astype("<f4").tofile(out + "/ephem/ephem.f32")
json.dump(dict(t0_unix=t0, step_s=900, n=N, frame="MOON_ME"), open(out + "/ephem/ephem.json", "w"))

# tiny index: 76x76 cells of 4 km, two months
e = le.Engine()
e.load_terrain_dir(out)
e.load_ephemeris_files(out + "/ephem/ephem.json", out + "/ephem/ephem.f32")
nx = ny = 76; cell = 4000.0; x0 = -152000.0; y0 = 152000.0; n_az = 360; step = 10800.0
H = e.grid_horizons(nx, ny, x0, y0, cell, n_az, 2.0, -85.0)
jj, ii = np.meshgrid(np.arange(nx), np.arange(ny))
X = x0 + (jj + 0.5) * cell; Y = y0 - (ii + 0.5) * cell
rho = np.hypot(X, Y)
lat = -90 + 2 * np.degrees(np.arctan(rho / (2 * R))); lon = np.degrees(np.arctan2(X, Y))
valid = lat <= -85.0
elev = height(X, Y).astype("f4")
rng = np.random.default_rng(1)
cols = {"lat": lat, "lon": lon, "elev_m": elev, "slope_deg": rng.uniform(0, 15, lat.shape),
        "sun_frac_5yr": np.full(lat.shape, .3), "earth_frac_5yr": np.full(lat.shape, .5),
        "psr_dist_km": rng.uniform(0, 30, lat.shape), "fault_dist_km": np.full(lat.shape, np.nan)}
blob = b"".join(np.where(valid, c, np.nan).astype("<f4").tobytes() for c in cols.values())
open(out + "/index/static.f32", "wb").write(blob)
months = []
for m, (name, start, days) in enumerate([("2026-02", 1769904000, 28), ("2026-03", 1769904000 + 28 * 86400, 31)]):
    ns = days * 8
    s, ea = e.grid_bitsets(H, float(start), ns, step, 2.0, x0, y0, cell, elev.reshape(-1))
    open(f"{out}/index/months/{name}.u64", "wb").write(s.astype("<u8").tobytes() + ea.astype("<u8").tobytes())
    months.append(dict(month=name, file=f"index/months/{name}.u64", t0_unix=start, n_steps=ns, words=(ns + 63) // 64))
rpb = 38
bands = []
for b in range(0, ny, rpb):
    open(f"{out}/index/horizons/b{b // rpb}.i16", "wb").write(H[b:b + rpb].astype("<i2").tobytes())
    bands.append(f"index/horizons/b{b // rpb}.i16")
json.dump(dict(grid=dict(proj="south_stereo", cell_m=cell, x0=x0, y0=y0, nx=nx, ny=ny, max_lat=-85.0), height_m=2, n_az=n_az,
               step_s=step, static=dict(file="index/static.f32", columns=list(cols)),
               horizons=dict(rows_per_band=rpb, bands=bands, scale_deg=0.01), months=months),
          open(out + "/index/manifest.json", "w"))
print("synthetic data written to", out)
