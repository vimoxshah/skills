#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# converge.sh — capture a page at MANY points along a timeline, waiting at each
# one until the page has actually arrived there, instead of screenshotting on a
# timer and hoping.
#
#   converge.sh <url> <outdir> [--offsets 0,600,1200,2400]
#                              [--steps N]
#                              [--viewport 1280x800]
#                              [--dpr 1]
#                              [--settle-timeout 4000]
#                              [--dwell 180]
#                              [--poll 60]
#                              [--dead-scroll-delta 0.25]
#                              [--cues '.headline,.sub']
#                              [--ignore-motion '#progressbar']
#                              [--cue-threshold 0.8]
#                              [--require '.nav,.cta']
#                              [--fonts '700 16px "Inter"|300 16px "Anton"']
#                              [--reduced-motion]
#                              [--full-page]
#
# WHICH CAPTURE STRATEGY IS THIS
#   This is wait-for-convergence. Use it to verify MULTIPLE points along a
#   timeline — a scroll narrative, a multi-step animation, a deck transition.
#   For the END STATE of a static or single-state page, use the force-final-
#   state strategy instead (scripts/settle-template.js), which is faster and
#   deterministic but structurally blind to intermediate states. Neither
#   replaces the other; SKILL.md section 3 has the decision.
#
# --offsets is the STABLE path and the recommendation. --steps spaces samples
# uniformly by document length, so adding a section anywhere moves every sample
# and findings come and go with unrelated edits. Pin the offsets you care about.
#
# Cell naming: s<NN>__y<NNNNN>.png, so the sheet reads in scroll order and
# contact-sheet.sh / baseline.sh (both glob top-level *.png only) work on this
# outdir directly — manifest.txt and report.json sit alongside harmlessly.
# Do not build a second contact sheet.
#
# Exits nonzero on a dead-scroll finding, a weak cue, or ANY sample that did
# not settle — an unsettled sample means your evidence is a mid-flight frame.
# ---------------------------------------------------------------------------
set -euo pipefail

usage() { sed -n '2,41p' "$0" >&2; exit 1; }

[ $# -ge 2 ] || usage
URL="$1"; shift
OUTDIR="$1"; shift

case "$URL" in --*) echo "converge.sh: first argument must be a url or path, got '$URL'" >&2; usage ;; esac

PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --offsets|--steps|--viewport|--dpr|--settle-timeout|--dwell|--poll| \
    --dead-scroll-delta|--cues|--cue-threshold|--require|--fonts|--ignore-motion)
      [ $# -ge 2 ] || { echo "converge.sh: $1 needs a value" >&2; usage; }
      PASS+=("$1" "$2"); shift 2 ;;
    --reduced-motion|--full-page)
      PASS+=("$1"); shift ;;
    *) echo "converge.sh: unknown arg: $1" >&2; usage ;;
  esac
done

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
DRIVER="$SELF_DIR/converge-driver.mjs"
[ -f "$DRIVER" ] || { echo "converge.sh: driver missing: $DRIVER" >&2; exit 1; }

command -v node >/dev/null 2>&1 || {
  echo "converge.sh: node not found. This mode needs a live DevTools session to" >&2
  echo "  decide WHEN to shoot, which --screenshot cannot express; the driver" >&2
  echo "  speaks CDP over node's built-in WebSocket (node >= 22, no npm deps)." >&2
  exit 1
}

# node's global WebSocket landed in 22. Fail with the reason, not a stack trace.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "converge.sh: node $NODE_MAJOR is too old — needs >= 22 for a built-in WebSocket" >&2
  exit 1
fi

# --- browser: reuse render.sh's discovery, never duplicate find_browser() ----
DOCTOR_OUT="$("$SELF_DIR/render.sh" doctor)"
BROWSER="$(printf '%s\n' "$DOCTOR_OUT" | sed -n '1s/^browser: //p')"
[ -n "$BROWSER" ] && [ -x "$BROWSER" ] || {
  echo "converge.sh: could not resolve a browser via 'render.sh doctor'" >&2; exit 1;
}

# chrome-headless-shell and bundled Chromium ship WITHOUT the H.264 decoder, so
# an h264 <video> never decodes, never reaches readyState 2, and the media half
# of the convergence wait times out on every sample. Say so up front instead of
# letting it look like the page is broken. render.sh honours CHROME_BIN, so
# CHROME_BIN=/Applications/Google Chrome.app/... fixes it.
case "$BROWSER" in
  *headless_shell*|*headless-shell*|*Chromium*)
    echo "converge.sh: NOTE: using ${BROWSER##*/} — no H.264 decoder. If this page" >&2
    echo "  has <video>, set CHROME_BIN to system Chrome or every sample will time" >&2
    echo "  out waiting on readyState. Pages without media are unaffected." >&2
    ;;
esac

mkdir -p "$OUTDIR"

exec node "$DRIVER" \
  --browser "$BROWSER" \
  --url "$URL" \
  --out "$OUTDIR" \
  ${PASS+"${PASS[@]}"}
