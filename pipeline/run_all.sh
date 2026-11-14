#!/usr/bin/env bash
# One-shot data pipeline (used by CI). Runnable from any cwd. Every step is skipped when its outputs exist;
# FORCE=1 reruns everything. Outputs: web/public/data/.
set -euo pipefail
PIPE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$PIPE")"
D="$ROOT/web/public/data"
PY="$PIPE/.venv/bin/python"
FORCE="${FORCE:-0}"
T_ALL=$SECONDS

# step <name> <sentinel file...> -- <command...>: run command unless all sentinels exist.
step() {
  local name="$1"; shift
  local sentinels=()
  while [[ "$1" != "--" ]]; do sentinels+=("$1"); shift; done
  shift
  local done_=1
  for s in "${sentinels[@]}"; do [[ -e "$s" ]] || done_=0; done
  if [[ "$FORCE" != "1" && "$done_" == "1" ]]; then
    echo "[skip ] $name"
    return 0
  fi
  echo "[run  ] $name"
  local t=$SECONDS
  "$@"
  echo "[done ] $name in $((SECONDS - t))s"
}

needs_index() { [[ "$FORCE" == "1" || ! -e "$D/index/manifest.json" || ! -e "$D/curated.json" || ! -e "$D/missions_pred.json" || ! -e "$D/global/manifest.json" ]]; }

build_engine() {
  rm -rf "$PIPE/work/wheels"
  ( cd "$ROOT" && uvx maturin build --release -m engine/Cargo.toml --out "$PIPE/work/wheels" )
  uv pip install --python "$PY" --force-reinstall --no-deps "$PIPE"/work/wheels/lunar_engine-*.whl
}

cd "$PIPE"
mkdir -p "$PIPE/work"
step "uv sync" "$PIPE/.venv/bin/python" -- uv sync --project "$PIPE"
step "fetch" "$D/ephem/ephem.json" "$D/terrain/manifest.json" "$D/imagery/color/meta.json" "$D/dsn/dsn.json" -- "$PY" fetch.py
step "ephem" "$D/ephem/ephem.json" "$D/ephem/ephem.f32" -- "$PY" ephem.py
step "tiles" "$D/terrain/manifest.json" -- "$PY" tiles.py
step "imagery" "$D/imagery/color/meta.json" -- "$PY" imagery.py
step "dsn" "$D/dsn/dsn.json" "$D/dsn/dsn.i16" -- "$PY" dsn.py

if needs_index; then
  if [[ "$FORCE" == "1" ]] || ! "$PY" -c "import lunar_engine; lunar_engine.Engine.global_grid_horizons" 2>/dev/null; then
    t=$SECONDS; echo "[run  ] engine wheel"; build_engine; echo "[done ] engine wheel in $((SECONDS - t))s"
  else
    echo "[skip ] engine wheel (lunar_engine importable)"
  fi
else
  echo "[skip ] engine wheel (index/curated/missions_pred up to date)"
fi

step "index" "$D/index/manifest.json" -- "$PY" index.py
step "global_index" "$D/global/manifest.json" -- "$PY" global_index.py
step "curated" "$D/curated.json" -- "$PY" curated.py
step "missions_pred" "$D/missions_pred.json" -- "$PY" missions_pred.py
step "layers" "$D/layers/manifest.json" -- bash -c "\"$PY\" validate_pgda.py --fetch && \"$PY\" layers.py"
# cheap and tracks data-src edits, so always run
step "copy_catalogs" "/nonexistent" -- "$PY" copy_catalogs.py
echo "pipeline finished in $((SECONDS - T_ALL))s"
