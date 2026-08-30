#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# contact-sheet.sh — tile a directory of PNG cells into ONE image a human
# can actually read in one look, instead of opening N screenshots one at a
# time (which is how real regressions get missed between cells 30 and 40).
#
#   contact-sheet.sh <indir> <out.png> [--cols N] [--label-height N]
#
# <indir>           directory of *.png cells. matrix.sh's outdir works
#                    directly — manifest.txt and any _approved/ baseline
#                    subdir (see baseline.sh) are ignored, not tiled.
# --cols N          columns per row (default: ceil(sqrt(count)), a roughly
#                    square grid).
# --label-height N  montage label text pointsize in px (default 14). Every
#                    tile is labelled with its filename so a cell is
#                    identifiable without leaving the sheet.
#
# Handles 1..60 (or more) input images. The montage is always resized
# shrink-only so its LONG edge stays <= 2200px — a sheet nobody can read at
# native resolution defeats the point of tiling.
# ---------------------------------------------------------------------------
set -euo pipefail

usage() { sed -n '2,17p' "$0" >&2; exit 1; }

[ $# -ge 2 ] || usage
INDIR="$1"; shift
OUT="$1"; shift
COLS=""
LABEL_HEIGHT=14

while [ $# -gt 0 ]; do
  case "$1" in
    --cols) COLS="$2"; shift 2 ;;
    --label-height) LABEL_HEIGHT="$2"; shift 2 ;;
    *) echo "contact-sheet.sh: unknown arg: $1" >&2; usage ;;
  esac
done

[ -d "$INDIR" ] || { echo "contact-sheet.sh: no such directory: $INDIR" >&2; exit 1; }
command -v magick >/dev/null 2>&1 || { echo "contact-sheet.sh: ImageMagick 'magick' not found" >&2; exit 1; }

# Only top-level *.png cells. Never manifest.txt, never a nested _approved/
# baseline dir written by baseline.sh — a contact sheet of a baseline
# directory's own baselines would be nonsense.
FILES=()
while IFS= read -r -d '' f; do
  FILES+=("$f")
done < <(find "$INDIR" -maxdepth 1 -type f -name '*.png' -print0 | sort -z)

COUNT=${#FILES[@]}
[ "$COUNT" -gt 0 ] || { echo "contact-sheet.sh: no PNG files directly in $INDIR" >&2; exit 1; }

if [ -z "$COLS" ]; then
  # ceil(sqrt(COUNT)), integer arithmetic only — a roughly square grid
  COLS=1
  while [ $((COLS * COLS)) -lt "$COUNT" ]; do COLS=$((COLS + 1)); done
fi

# -geometry '400x+4+4' : fixed WIDTH per thumbnail (proportional height) so
# mixed cell sizes (different viewports, dpr1 vs dpr2) still line up into
# even rows/columns instead of montage padding ragged gaps.
magick montage \
  -label '%f' \
  -pointsize "$LABEL_HEIGHT" \
  -tile "${COLS}x" \
  -geometry '400x+4+4' \
  -background '#222222' \
  -fill white \
  "${FILES[@]}" \
  miff:- \
  | magick - -resize '2200x2200>' "$OUT"

[ -s "$OUT" ] || { echo "contact-sheet.sh: failed to produce $OUT" >&2; exit 1; }
echo "contact-sheet.sh: wrote $OUT ($COUNT cells, ${COLS} cols)"
