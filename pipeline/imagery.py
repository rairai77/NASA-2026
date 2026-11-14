"""SVS CGI Moon Kit color map -> Cesium GeographicTilingScheme JPEG pyramid.

Level z has 2^(z+1) x 2^z tiles of 256x256; x=0 starts at lon -180, y=0 at the north.
The SVS 8K map is plate carree with lon 0 at the image center (verified by correlating with LOLA DEM).
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
HERE = Path(__file__).parent
SRC = HERE / "raw" / "svs" / "lroc_color_poles_8k.tif"
OUT = HERE.parent / "web" / "public" / "data" / "imagery" / "color"
TS = 256

def main():
    im = Image.open(SRC).convert("RGB")
    W, H = im.size
    assert W == 2 * H and H % TS == 0
    max_level = int(np.log2(H // TS))
    for z in range(max_level + 1):
        nx, ny = 2 ** (z + 1), 2 ** z
        lv = im if z == max_level else im.resize((nx * TS, ny * TS), Image.LANCZOS)
        for y in range(ny):
            d = OUT / str(z)
            for x in range(nx):
                (d / str(x)).mkdir(parents=True, exist_ok=True)
                lv.crop((x * TS, y * TS, (x + 1) * TS, (y + 1) * TS)).save(
                    d / str(x) / f"{y}.jpg", quality=85, optimize=True)
    meta = {"maxLevel": max_level, "tileSize": TS,
            "source": "NASA SVS 4720 CGI Moon Kit, lroc_color_poles_8k.tif (LROC WAC color mosaic); "
                      "GeographicTilingScheme, lon -180..180 left to right, lat 90..-90 top to bottom"}
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))
    n = sum(1 for _ in OUT.rglob("*.jpg"))
    print("tiles", n, "bytes", sum(p.stat().st_size for p in OUT.rglob("*.jpg")))

if __name__ == "__main__":
    main()
