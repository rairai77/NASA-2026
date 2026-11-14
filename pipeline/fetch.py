"""Download raw inputs into pipeline/raw/ (resumable, skips complete files)."""
import sys
from pathlib import Path
import requests
from tqdm import tqdm

RAW = Path(__file__).parent / "raw"
NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
GDR = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/"
SVS = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/"
DIVINER = "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp/"

NAIF_FILES = [
    "lsk/naif0012.tls", "spk/planets/de440s.bsp", "pck/moon_pa_de440_200625.bpc",
    "fk/satellites/moon_de440_250416.tf", "pck/pck00011.tpc",
    "pck/earth_1962_260806_2126_combined.bpc", "fk/stations/earth_topo_260814.tf",
    "spk/stations/earthstns_itrf93_260814.bsp", "pck/gm_de440.tpc",
]
DEMS = [("polar", "ldem_85s_20m"), ("polar", "ldem_80s_80m"), ("polar", "ldem_60s_240m"),
        ("cylindrical", "ldem_64"), ("cylindrical", "ldem_16"), ("cylindrical", "ldem_4")]

def jobs():
    for f in NAIF_FILES:
        yield NAIF + f, RAW / "naif" / Path(f).name
    for sub, n in DEMS:
        for ext in ("lbl", "img"):
            yield f"{GDR}{sub}/img/{n}.{ext}", RAW / "lola" / f"{n}.{ext}"
    yield SVS + "lroc_color_poles_8k.tif", RAW / "svs" / "lroc_color_poles_8k.tif"
    # Diviner Polar Resource Product (annual max / avg temperature, 75-90S) for the globe layers
    for ext in ("lbl", "xml", "tab"):
        yield f"{DIVINER}dlre_prp_south.{ext}", RAW / "diviner" / f"dlre_prp_south.{ext}"

def fetch(url, dest, s):
    dest.parent.mkdir(parents=True, exist_ok=True)
    h = s.head(url, allow_redirects=True, timeout=60)
    if h.status_code != 200:
        print(f"SKIP {url}: HTTP {h.status_code}"); return
    size = int(h.headers.get("Content-Length", 0))
    have = dest.stat().st_size if dest.exists() else 0
    if size and have == size:
        print(f"ok   {dest.name} ({size} B)"); return
    if size and have > size:
        dest.unlink(); have = 0
    hdr = {"Range": f"bytes={have}-"} if have else {}
    with s.get(url, headers=hdr, stream=True, timeout=60) as r:
        if r.status_code == 200 and have:
            have = 0
        elif r.status_code not in (200, 206):
            raise RuntimeError(f"{url}: HTTP {r.status_code}")
        mode = "ab" if have else "wb"
        with open(dest, mode) as fh, tqdm(total=size, initial=have, unit="B", unit_scale=True,
                                          desc=dest.name, leave=False) as bar:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk); bar.update(len(chunk))
    if size and dest.stat().st_size != size:
        raise RuntimeError(f"size mismatch for {dest}")
    print(f"done {dest.name}")

if __name__ == "__main__":
    s = requests.Session()
    for url, dest in jobs():
        for attempt in range(4):
            try:
                fetch(url, dest, s); break
            except Exception as e:
                print("retry", dest.name, e, file=sys.stderr)
