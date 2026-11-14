#!/usr/bin/env bash
# Download the data tarball parts from release data-latest, reassemble and extract into
# web/public/data/. Requires gh (GH_TOKEN in CI).
#   env: PARTS_DIR  use already-downloaded parts from this dir instead of downloading
#        DEST_DIR   extraction parent (default web/public); archive holds "data/"
#        REPO       override repo (default: current repo / GITHUB_REPOSITORY)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${DEST_DIR:-$ROOT/web/public}"
PARTS_DIR="${PARTS_DIR:-}"
CLEANUP=0
if [[ -z "$PARTS_DIR" ]]; then
  PARTS_DIR="$(mktemp -d)"
  CLEANUP=1
  repo_args=()
  [[ -n "${REPO:-${GITHUB_REPOSITORY:-}}" ]] && repo_args=(--repo "${REPO:-$GITHUB_REPOSITORY}")
  gh release download data-latest "${repo_args[@]}" --dir "$PARTS_DIR" \
    --pattern 'data.tar.part-*' --pattern 'data.tar.sha256'
fi

if [[ -f "$PARTS_DIR/data.tar.sha256" ]]; then
  ( cd "$PARTS_DIR" && sha256sum -c data.tar.sha256 )
fi

mkdir -p "$DEST_DIR"
rm -rf "$DEST_DIR/data"
cat "$PARTS_DIR"/data.tar.part-* | tar -C "$DEST_DIR" -xf -
[[ "$CLEANUP" == "1" ]] && rm -rf "$PARTS_DIR"
echo "Extracted $(find "$DEST_DIR/data" -type f | wc -l) files into $DEST_DIR/data"
