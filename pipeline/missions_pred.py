"""Mission validation predictions: web/public/data/missions_pred.json.

For each mission: horizon at the lander, Sun/Earth series from landing-2 d to landing+20 d (300 s steps; stored as
events + a 30-min downsample), predicted first local sunset / earthset after landing and Δ vs reported end_utc.
"""
import datetime as dt, json, sys, time
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"
H = 2.0

def ts(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

def iso(t):
    return None if t is None else dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def main():
    import lunar_engine
    eng = lunar_engine.Engine()
    eng.load_ephemeris_files(str(DATA / "ephem" / "ephem.json"), str(DATA / "ephem" / "ephem.f32"))
    eng.load_terrain_dir(str(DATA))
    missions = json.loads((ROOT / "data-src" / "missions.json").read_text())
    out = {}
    rows = []
    for m in missions:
        info = eng.horizon_info(m["lat"], m["lon"], H, 720)
        hz = np.asarray(info["elev_deg"], np.float32)
        land = ts(m["landed_utc"])
        t0, t1 = land - 2 * 86400, land + 20 * 86400
        v = eng.visibility(m["lat"], m["lon"], H, hz, t0, t1, 300.0, info["site_elev_m"])
        ev = [{"t": round(e["t"]), "utc": iso(e["t"]), "kind": e["kind"]} for e in v["events"]]
        def first(kind):
            c = [e["t"] for e in v["events"] if e["kind"] == kind and e["t"] > land]
            return min(c) if c else None
        eset = first("earthset")
        sset_ecl = first("sunset")  # engine event: Sun visible fraction < 0.5, includes Earth-eclipse dimming
        # eclipse-free sunset (horizon only): Sun centre crosses the horizon profile downward (== frac 0.5 for a flat horizon),
        # linear interpolation on the 300 s series
        tt = np.asarray(v["t"]); az = np.asarray(v["sun_az"], float) % 360
        hzi = np.interp(az, np.arange(721) * 0.5, np.append(hz, hz[0]).astype(float))
        gap = np.asarray(v["sun_el"], float) - hzi
        sset = None
        for k in range(len(tt) - 1):
            if tt[k + 1] > land and gap[k] >= 0 > gap[k + 1]:
                sset = float(tt[k] + gap[k] / (gap[k] - gap[k + 1]) * (tt[k + 1] - tt[k])); break
        end = ts(m["end_utc"]) if m.get("end_utc") else None
        d = None if sset is None or end is None else (sset - end) / 3600
        sl = slice(None, None, 6)  # 300 s -> 30 min
        series = {"t0": round(float(v["t"][0])), "step_s": 1800,
                  "sun_el": [round(float(x), 2) for x in v["sun_el"][sl]],
                  "sun_frac": [round(float(x), 3) for x in v["sun_frac"][sl]],
                  "earth_el": [round(float(x), 2) for x in v["earth_el"][sl]],
                  "earth_up": [int(x) for x in v["earth_up"][sl]]}
        out[m["id"]] = {"lat": m["lat"], "lon": m["lon"], "landed_utc": m["landed_utc"], "end_utc": m.get("end_utc"), "end_kind": m.get("end_kind"),
                        "site_elev_m": round(info["site_elev_m"], 2), "resolution_m": info["resolution_m"],
                        "horizon": [round(float(x), 3) for x in hz],
                        "window": {"t_start": round(t0), "t_end": round(t1)},
                        "predicted_sunset_utc": iso(sset), "predicted_sunset_incl_eclipse_utc": iso(sset_ecl), "predicted_earthset_utc": iso(eset),
                        "sunset_minus_end_h": None if d is None else round(d, 2),
                        "metrics": {k: round(float(x), 4) for k, x in v["metrics"].items()},
                        "events": ev, "series": series}
        rows.append((m["id"], m["landed_utc"], iso(sset), m.get("end_utc"), d, m.get("end_kind")))
    p = DATA / "missions_pred.json"
    p.write_text(json.dumps(out, separators=(",", ":")))
    print(f"{'id':14s} {'landed':21s} {'pred sunset':21s} {'reported end':21s} {'dh':>8s} end_kind")
    for i, l, s, e, d, k in rows:
        print(f"{i:14s} {l:21s} {str(s):21s} {str(e):21s} {('%.1f' % d) if d is not None else 'n/a':>8s} {k}")
    print(f"wrote {p} {p.stat().st_size/1e3:.0f} kB")

if __name__ == "__main__":
    main()
