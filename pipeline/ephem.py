"""Sun/Earth positions relative to the Moon center in MOON_ME (CONTRACTS §1)."""
import json
from pathlib import Path
import numpy as np
import spiceypy as sp

HERE = Path(__file__).parent
K = HERE / "raw" / "naif"
OUT = HERE.parent / "web" / "public" / "data" / "ephem"
KERNELS = ["naif0012.tls", "de440s.bsp", "moon_pa_de440_200625.bpc", "moon_de440_250416.tf"]
T0_UNIX, STEP, N = 1672531200, 900, 280512  # 2023-01-01 .. 2031-01-01 exclusive

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for k in KERNELS:
        sp.furnsh(str(K / k))
    et0 = sp.str2et("2023-01-01T00:00:00")  # UTC via LSK
    assert abs(sp.str2et("2031-01-01T00:00:00") - et0 - N * STEP) < 1e-3
    # ET advances by UTC seconds (no leap seconds 2023-2031), so ET grid is uniform
    ets = et0 + STEP * np.arange(N)
    out = np.empty((N, 6), np.float32)
    for i, et in enumerate(ets):
        out[i, :3] = sp.spkpos("SUN", et, "MOON_ME", "LT+S", "MOON")[0]
        out[i, 3:] = sp.spkpos("EARTH", et, "MOON_ME", "LT+S", "MOON")[0]
    out.astype("<f4").tofile(OUT / "ephem.f32")
    meta = {"t0_unix": T0_UNIX, "step_s": STEP, "n": N, "frame": "MOON_ME", "origin": "MOON",
            "abcorr": "LT+S",
            "columns": ["sun_x_km", "sun_y_km", "sun_z_km", "earth_x_km", "earth_y_km", "earth_z_km"],
            "kernels": KERNELS, "start_utc": "2023-01-01T00:00:00Z", "end_utc": "2031-01-01T00:00:00Z"}
    (OUT / "ephem.json").write_text(json.dumps(meta, indent=1))
    print("rows", N, "bytes", out.nbytes, "first", out[0], "dist sun/earth km", np.linalg.norm(out[0, :3]), np.linalg.norm(out[0, 3:]))

if __name__ == "__main__":
    main()
