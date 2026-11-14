#!/usr/bin/env bash
# Build the Rust engine for the browser into web/src/engine/pkg.
# Needs: rustup target add wasm32-unknown-unknown; cargo install wasm-pack --locked
set -euo pipefail
cd "$(dirname "$0")/.."
wasm-pack build engine --release --target web --out-dir ../web/src/engine/pkg -- --features wasm
# wasm-pack writes a .gitignore ("*") into the pkg dir; the repo ignores it separately.
echo "built web/src/engine/pkg"
