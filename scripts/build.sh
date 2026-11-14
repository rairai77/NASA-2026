#!/usr/bin/env bash
# Build the WASM engine into web/src/engine/pkg, then the web app into web/dist.
# SKIP_WASM=1 skips the wasm step (e.g. when pkg/ is already built).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${SKIP_WASM:-0}" != "1" ]]; then
  wasm-pack build engine --release --target web --out-dir ../web/src/engine/pkg -- --features wasm
fi

cd web
npm ci
npm run build
