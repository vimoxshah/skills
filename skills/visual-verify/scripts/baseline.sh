#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# baseline.sh — approve a set of matrix cells as the known-good baseline,
# then diff future renders against it so a regression shows up as a number,
# not a hunch.
#
#   baseline.sh approve <dir>
#   baseline.sh diff    <dir> [--tolerance N]
#
# <dir> is a matrix.sh outdir: its top-level *.png cells are the subject.
#
# `approve` copies them into <dir>/_approved/ (glob is top-level *.png only
#  — manifest.txt and _approved/ itself are excluded — so re-running approve
#  re-baselines the current cells, it never nests baselines inside
#  baselines).
#
# `diff` compares each current cell against <dir>/_approved/<same-name>.png
# using ImageMagick `compare -metric AE` (count of differing pixels), one
# line per cell to stdout:
#   NEW    <name>   — no baseline exists for this cell. NOT a failure: a
#                      matrix that grew a state/theme/viewport is not a
#                      regression by itself.
#   DIMS   <name>   — baseline exists but at a different pixel size. IS a
#                      failure. (ImageMagick's `compare` does not error on a
#                      size mismatch — it silently rescales one image onto
#                      the other's canvas and reports a distorted, useless
#                      count. Dimensions are checked explicitly first so a
#                      viewport/dpr change is never laundered into a small
#                      or misleading AE number.)
#   <N>    <name>   — AE pixel-diff count. Exit nonzero if the run produced
#                      ANY cell whose count exceeds --tolerance (default 0:
#                      exact match required).
# ---------------------------------------------------------------------------
set -euo pipefail

usage() { sed -n '2,26p' "$0" >&2; exit 1; }

[ $# -ge 2 ] || usage
CMD="$1"; shift
DIR="$1"; shift
TOLERANCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --tolerance) TOLERANCE="$2"; shift 2 ;;
    *) echo "baseline.sh: unknown arg: $1" >&2; usage ;;
  esac
done

[ -d "$DIR" ] || { echo "baseline.sh: no such directory: $DIR" >&2; exit 1; }
command -v magick >/dev/null 2>&1 || { echo "baseline.sh: ImageMagick 'magick' not found" >&2; exit 1; }

APPROVED="$DIR/_approved"

# Top-level *.png cells only — never manifest.txt, never _approved/ itself.
list_cells() {
  find "$DIR" -maxdepth 1 -type f -name '*.png' -print0 | sort -z
}

dims_of() { magick identify -format '%wx%h' "$1" 2>/dev/null; }

case "$CMD" in
  approve)
    mkdir -p "$APPROVED"
    COUNT=0
    while IFS= read -r -d '' f; do
      cp "$f" "$APPROVED/$(basename "$f")"
      COUNT=$((COUNT + 1))
    done < <(list_cells)
    [ "$COUNT" -gt 0 ] || { echo "baseline.sh: no PNG cells found in $DIR to approve" >&2; exit 1; }
    echo "baseline.sh: approved $COUNT cell(s) into $APPROVED"
    ;;

  diff)
    [ -d "$APPROVED" ] || { echo "baseline.sh: no baseline at $APPROVED — run 'approve' first" >&2; exit 1; }
    FAIL=0
    COUNT=0
    while IFS= read -r -d '' f; do
      name="$(basename "$f")"
      base="$APPROVED/$name"
      COUNT=$((COUNT + 1))

      if [ ! -f "$base" ]; then
        echo "NEW	$name"
        continue
      fi

      cur_dims="$(dims_of "$f")"
      base_dims="$(dims_of "$base")"
      if [ "$cur_dims" != "$base_dims" ]; then
        echo "DIMS	$name	baseline=$base_dims current=$cur_dims"
        FAIL=1
        continue
      fi

      # compare writes "<scaled-total> (<pixel-count>)" to STDERR and exits
      # 1 whenever AE > 0 — never let set -e treat that as a script error.
      # The number in parentheses is the actual differing-pixel count; the
      # leading number is a quantum-scaled total, not a pixel count (verified
      # empirically: a 10x10 differing patch on a 100x100 image reports
      # "6.5535e+06 (100)" — 100 is the true count, 6.5535e6 = 100 * 65535).
      AE_RAW="$(magick compare -metric AE "$base" "$f" null: 2>&1 1>/dev/null || true)"
      AE="$(printf '%s' "$AE_RAW" | sed -n 's/.*(\([0-9.]*\)).*/\1/p')"
      if [ -z "$AE" ]; then
        echo "ERROR	$name	$AE_RAW"
        FAIL=1
        continue
      fi
      AE_INT="${AE%%.*}"
      echo "$AE_INT	$name"
      if [ "$AE_INT" -gt "$TOLERANCE" ]; then
        FAIL=1
      fi
    done < <(list_cells)
    [ "$COUNT" -gt 0 ] || { echo "baseline.sh: no PNG cells found in $DIR to diff" >&2; exit 1; }
    exit "$FAIL"
    ;;

  *)
    usage
    ;;
esac
