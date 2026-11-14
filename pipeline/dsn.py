"""Moon elevation (deg) above the local horizon from DSS-14/43/63 on the ephemeris time grid."""
import json
from pathlib import Path
import numpy as np
import spiceypy as sp

HERE = Path(__file__).parent
K = HERE / "raw" / "naif"
OUT = HERE.parent / "web" / "public" / "data" / "dsn"
KERNELS = ["naif0012.tls", "de440s.bsp", "pck00011.tpc", "earth_1962_260806_2126_combined.bpc",
           "earth_topo_260814.tf", "earthstns_itrf93_260814.bsp"]
STATIONS = ["DSS-14", "DSS-43", "DSS-63"]
T0_UNIX, STEP, N = 1672531200, 900, 280512

def moon_elevation(station, ets):
    """Geometric (no refraction) elevation of the Moon center, LT+S, in the station's TOPO frame."""
    out = np.empty(len(ets))
    for i, et in enumerate(ets):
        r = sp.spkpos("MOON", et, f"{station}_TOPO", "LT+S", station)[0]
        out[i] = np.degrees(np.arcsin(r[2] / np.linalg.norm(r)))
    return out

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for k in KERNELS:
        sp.furnsh(str(K / k))
    ets = sp.str2et("2023-01-01T00:00:00") + STEP * np.arange(N)
    el = np.stack([moon_elevation(s, ets) for s in STATIONS], axis=1)
    q = np.round(el * 100).astype("<i2")
    q.tofile(OUT / "dsn.i16")
    meta = {"t0_unix": T0_UNIX, "step_s": STEP, "n": N, "stations": STATIONS, "scale": 0.01,
            "note": "geometric Moon-center elevation (deg) above local horizon, LT+S, no refraction; row-major n x 3 int16"}
    (OUT / "dsn.json").write_text(json.dumps(meta, indent=1))
    print("elevation range", el.min(), el.max(), "mean up-fraction", (el > 0).mean(axis=0))
    t = sp.str2et("2026-06-01T12:00:00")
    for s in STATIONS:
        print(s, "2026-06-01T12:00Z el", moon_elevation(s, [t])[0])

if __name__ == "__main__":
    main()
