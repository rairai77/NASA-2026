#!/usr/bin/env python3
"""Convert LROC lobate scarp shapefiles to data-src/faults.geojson.

Inputs (download, unzip; both are public LROC RDR products):
  LOBATE_SCARPS_180.ZIP        (60S-60N polylines)
  POLAR_SCARP_LOCATIONS_180.ZIP (poles, point locations)
under https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/EXTRAS/SHAPEFILE/

Usage: uv run --with pyshp python build_faults.py <LOBATE_SCARPS_180 stem> <POLAR_SCARP_LOCATIONS_180 stem> [out]
"""
import json, math, sys
import shapefile

R = 1737.4
def wrap(l):
    return ((l + 180.0) % 360.0) - 180.0
def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[1], a[0], b[1], b[0]))
    h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 2*R*math.asin(math.sqrt(h))

def main(g, p, out="faults.geojson"):
    feats = []
    src_g = "https://data.lroc.im-ldi.com/lroc/view_rdr/SHAPEFILE_LOBATE_SCARPS"
    src_p = "https://data.lroc.im-ldi.com/lroc/view_rdr/SHAPEFILE_POLAR_SCARP_LOCATIONS"
    r = shapefile.Reader(g)
    for i, sh in enumerate(r.shapes()):
        pts = [(wrap(x), y) for x, y in sh.points]
        parts = list(sh.parts) + [len(pts)]
        for a, b in zip(parts[:-1], parts[1:]):
            seg = pts[a:b]
            if len(seg) < 2: continue
            # avoid antimeridian jumps: skip splitting, segments are short
            L = sum(hav(seg[k], seg[k+1]) for k in range(len(seg)-1))
            feats.append({"type": "Feature",
              "geometry": {"type": "LineString", "coordinates": [[round(x, 4), round(y, 4)] for x, y in seg]},
              "properties": {"name": None, "kind": "lobate_scarp", "source": src_g, "length_km": round(L, 2), "coverage": "60S-60N"}})
    r = shapefile.Reader(p)
    fl = [f[0] for f in r.fields[1:]]
    for rec in r.records():
        d = dict(zip(fl, rec))
        feats.append({"type": "Feature",
          "geometry": {"type": "Point", "coordinates": [round(wrap(d["LON"]), 4), round(d["LAT"], 4)]},
          "properties": {"name": (d["NAME"] or "").strip() or None, "kind": "lobate_scarp", "source": src_p,
                         "individual_or_cluster": d["INDORCLUST"], "coverage": "polar 65-90"}})
    json.dump({"type": "FeatureCollection", "features": feats}, open(out, "w"), separators=(",", ":"))
    print(len(feats), "features")

if __name__ == "__main__":
    main(*sys.argv[1:])
