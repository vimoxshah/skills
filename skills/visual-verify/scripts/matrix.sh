#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# matrix.sh — render one page across a cartesian product of theme x viewport
# x dpr x state, so a design surface can be reviewed as a set of named PNGs
# instead of one guess-and-check screenshot at a time.
#
#   matrix.sh <url> <outdir> [--themes light,dark,system]
#                            [--viewports 1920x1080,1280x800,420x900]
#                            [--dpr 1,2]
#                            [--states <selector-or-hash-list>]
#
# Defaults if a flag is omitted: --themes system --viewports 1280x800
#                                 --dpr 1 --states (a single "default" state)
#
# THEME CELLS: for any theme other than "system", a throwaway COPY of the
# page is written with a stamping script appended that sets
# document.documentElement.setAttribute('data-theme', <theme>) — the source
# file is never touched. "system" renders the original, unstamped.
#
# STATE CELLS: a comma list where each entry is EITHER a URL hash
# (e.g. "#slide-1") — appended directly to the cell's URL — OR a keypress
# script name, implemented as a best-effort injected synthetic
# KeyboardEvent dispatch (see the capability note in SKILL.md's "Matrix
# mode" section: --screenshot mode has no CDP/input session, so this fires
# page-level listeners only, not real input).
#
# Cell naming: <state>__<theme>__<WxH>__dpr<N>.png
# Every cell is echoed to stdout and appended to <outdir>/manifest.txt as it
# is written.
# ---------------------------------------------------------------------------
set -euo pipefail

usage() { sed -n '2,26p' "$0" >&2; exit 1; }

[ $# -ge 2 ] || usage
URL="$1"; shift
OUTDIR="$1"; shift

THEMES="system"
VIEWPORTS="1280x800"
DPRS="1"
STATES=""

while [ $# -gt 0 ]; do
  case "$1" in
    --themes)    THEMES="$2"; shift 2 ;;
    --viewports) VIEWPORTS="$2"; shift 2 ;;
    --dpr)       DPRS="$2"; shift 2 ;;
    --states)    STATES="$2"; shift 2 ;;
    *) echo "matrix.sh: unknown arg: $1" >&2; usage ;;
  esac
done

mkdir -p "$OUTDIR"
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- browser: reuse render.sh's discovery, never duplicate find_browser() --
DOCTOR_OUT="$("$SELF_DIR/render.sh" doctor)"
BROWSER="$(printf '%s\n' "$DOCTOR_OUT" | sed -n '1s/^browser: //p')"
[ -n "$BROWSER" ] && [ -x "$BROWSER" ] || {
  echo "matrix.sh: could not resolve a browser via 'render.sh doctor'" >&2; exit 1;
}

# One isolated profile for the whole matrix run — cells render sequentially,
# so sharing it is safe and avoids spinning up N throwaway profile dirs.
PROFILE_DIR="$(mktemp -d -t vvmatrixprof)"
WORKDIR="$(mktemp -d -t vvmatrixwork)"
trap 'rm -rf "$PROFILE_DIR" "$WORKDIR"' EXIT

common_flags() {
  printf '%s\n' \
    --headless=new \
    --disable-gpu \
    --enable-unsafe-swiftshader \
    --hide-scrollbars \
    --allow-file-access-from-files \
    --no-first-run \
    --no-default-browser-check \
    --disable-extensions \
    "--user-data-dir=$PROFILE_DIR"
}

to_url() {
  case "$1" in
    http://*|https://*|file://*) printf '%s' "$1" ;;
    /*) printf 'file://%s' "$1" ;;
    *)  printf 'file://%s/%s' "$(pwd)" "$1" ;;
  esac
}

url_to_path() {
  case "$1" in
    file://*) printf '%s' "${1#file://}" ;;
    *) printf '%s' "$1" ;;
  esac
}

is_local() {
  case "$1" in http://*|https://*) return 1 ;; *) return 0 ;; esac
}

sanitize_name() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-'
}

# Splice a classic <script> just before </body> of $1 (or append it if the
# page has no closing tag), writing to $2. This is the same "copy, never
# edit the source" idiom render.sh's with_probe() uses.
inject_before_body() {
  local src="$1" out="$2" jsfile="$3"
  python3 - "$src" "$out" "$jsfile" <<'PY'
import io, sys
src, dst, jsfile = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(src, encoding='utf-8', errors='replace').read()
js = io.open(jsfile, encoding='utf-8').read()
tag = '<script>\n%s\n</script>\n</body>' % js
s = s.replace('</body>', tag) if '</body>' in s else s + tag
io.open(dst, 'w', encoding='utf-8').write(s)
PY
}

theme_script() {
  local theme="$1"
  cat <<JS
(function(){
  function stamp(){ document.documentElement.setAttribute('data-theme', '$theme'); }
  stamp();
  /* re-apply: beats a page's own localStorage/system-theme init that runs
     on DOMContentLoaded/load and would otherwise clobber the stamp */
  setTimeout(stamp, 50);
  setTimeout(stamp, 300);
  document.addEventListener('DOMContentLoaded', stamp);
  addEventListener('load', stamp);
})();
JS
}

keypress_script() {
  local key="$1"
  cat <<JS
(function(){
  /* Best-effort only: --screenshot mode has no CDP/input session, so this
     dispatches a synthetic KeyboardEvent that fires page-level
     addEventListener('keydown'/'keyup') handlers. It does NOT reproduce
     browser-default key behavior (scrolling, focus movement, etc). */
  function fire(){
    var opts = {key:'$key', code:'$key', bubbles:true, cancelable:true};
    document.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.dispatchEvent(new KeyboardEvent('keyup', opts));
  }
  setTimeout(fire, 400);
})();
JS
}

MANIFEST="$OUTDIR/manifest.txt"
: > "$MANIFEST"

IFS=',' read -ra THEME_LIST <<< "$THEMES"
IFS=',' read -ra VIEWPORT_LIST <<< "$VIEWPORTS"
IFS=',' read -ra DPR_LIST <<< "$DPRS"
if [ -z "$STATES" ]; then
  STATE_LIST=("default")
else
  IFS=',' read -ra STATE_LIST <<< "$STATES"
fi

CELL_COUNT=0

for theme in "${THEME_LIST[@]}"; do
  THEME_BASE_URL="$URL"
  if [ "$theme" != "system" ]; then
    if is_local "$URL"; then
      SRC_PATH="$(url_to_path "$URL")"
      TS_JS="$WORKDIR/theme-$(sanitize_name "$theme").js"
      theme_script "$theme" > "$TS_JS"
      THEME_HTML="$WORKDIR/theme-$(sanitize_name "$theme").html"
      inject_before_body "$SRC_PATH" "$THEME_HTML" "$TS_JS"
      THEME_BASE_URL="$(to_url "$THEME_HTML")"
    else
      echo "matrix.sh: WARNING: theme '$theme' requested for a remote URL — cannot stamp data-theme without a local copy; rendering unmodified" >&2
    fi
  fi

  for state in "${STATE_LIST[@]}"; do
    CELL_URL="$THEME_BASE_URL"
    STATE_NAME="default"
    case "$state" in
      ""|default) STATE_NAME="default" ;;
      "#"*)
        STATE_NAME="$(sanitize_name "${state#"#"}")"
        CELL_URL="${THEME_BASE_URL}${state}"
        ;;
      *)
        STATE_NAME="$(sanitize_name "$state")"
        if is_local "$URL"; then
          KP_SRC_PATH="$(url_to_path "$THEME_BASE_URL")"
          KP_JS="$WORKDIR/keypress-${STATE_NAME}.js"
          keypress_script "$state" > "$KP_JS"
          KP_HTML="$WORKDIR/kp-${STATE_NAME}__$(sanitize_name "$theme").html"
          inject_before_body "$KP_SRC_PATH" "$KP_HTML" "$KP_JS"
          CELL_URL="$(to_url "$KP_HTML")"
        else
          echo "matrix.sh: WARNING: keypress state '$state' needs a local copy to inject into — skipping for remote URL" >&2
          continue
        fi
        ;;
    esac

    for viewport in "${VIEWPORT_LIST[@]}"; do
      W="${viewport%x*}"; H="${viewport#*x}"
      for dpr in "${DPR_LIST[@]}"; do
        NAME="${STATE_NAME}__${theme}__${W}x${H}__dpr${dpr}.png"
        OUT="$OUTDIR/$NAME"
        # shellcheck disable=SC2046
        "$BROWSER" $(common_flags) \
          --window-size="${W},${H}" \
          --force-device-scale-factor="$dpr" \
          --virtual-time-budget=3000 \
          --screenshot="$OUT" \
          "$CELL_URL" >/dev/null 2>&1 || true
        if [ ! -s "$OUT" ]; then
          echo "matrix.sh: FAILED cell: $NAME (empty/missing screenshot)" >&2
          continue
        fi
        CELL_COUNT=$((CELL_COUNT + 1))
        LINE="$NAME	state=$STATE_NAME theme=$theme viewport=${W}x${H} dpr=$dpr url=$CELL_URL"
        echo "$LINE"
        echo "$LINE" >> "$MANIFEST"
      done
    done
  done
done

echo "matrix.sh: wrote $CELL_COUNT cell(s) to $OUTDIR (manifest: $MANIFEST)" >&2
[ "$CELL_COUNT" -gt 0 ] || exit 1
