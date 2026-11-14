"""Copy hand-curated catalogs from data-src/ to web/public/data/."""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for n in ("sites.json", "missions.json", "faults.geojson"):
    dst = ROOT / "web" / "public" / "data" / n
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / "data-src" / n, dst)
    print("copied", n, dst.stat().st_size, "bytes")
