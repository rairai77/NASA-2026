#!/usr/bin/env bash
# Package web/public/data into an uncompressed tar (files inside are already gzipped),
# split into parts < 1.9 GB under dist-data/. With --upload, publish them as assets of
# the GitHub release tagged data-latest.
#   env: DATA_DIR (default web/public/data), OUT_DIR (default dist-data), PART_SIZE (default 1900M)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$(cd "${DATA_DIR:-$ROOT/web/public/data}" && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/dist-data}"
PART_SIZE="${PART_SIZE:-1900M}"
UPLOAD=0
[[ "${1:-}" == "--upload" ]] && UPLOAD=1

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/data.tar.part-*
# Archive contains a single top-level "data/" directory regardless of DATA_DIR's real name.
tar -C "$(dirname "$DATA_DIR")" --transform "s#^$(basename "$DATA_DIR")#data#" -cf - "$(basename "$DATA_DIR")" \
  | split -b "$PART_SIZE" -d -a 3 - "$OUT_DIR/data.tar.part-"
( cd "$OUT_DIR" && sha256sum data.tar.part-* > data.tar.sha256 )
ls -l "$OUT_DIR"

if [[ "$UPLOAD" == "1" ]]; then
  if ! gh release view data-latest >/dev/null 2>&1; then
    gh release create data-latest --title "Processed data (latest)" \
      --notes "Processed lunar data tarball parts. Reassemble with scripts/fetch-data.sh." --prerelease
  fi
  # remove stale assets so a shrinking part count does not leave orphans
  for a in $(gh release view data-latest --json assets --jq '.assets[].name'); do
    gh release delete-asset data-latest "$a" --yes
  done
  gh release upload data-latest --clobber "$OUT_DIR"/data.tar.part-* "$OUT_DIR"/data.tar.sha256
else
  echo "Dry run: parts are in $OUT_DIR (pass --upload to publish to release data-latest)."
fi
