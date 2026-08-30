#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# render.sh — headless render/measure/diagnose loop for visual deliverables.
#
#   render.sh shot   <url> <out.png> [W] [H] [MS]   screenshot (viewport-only)
#   render.sh height <url>                          print document scrollHeight
#   render.sh dump   <url>                          print document.title (JSON probe)
#   render.sh doctor                                report the browser it will use
#
# <url> may be an absolute path or a file:// / http(s):// URL.
# ---------------------------------------------------------------------------
set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve a Chromium-family binary this machine can drive headlessly.
# Must echo an absolute path to an executable, or return non-zero.
# ---------------------------------------------------------------------------
#
# Preference order (first hit wins):
#   1. $CHROME_BIN            — explicit override always beats discovery
#   2. Playwright's cache     — "Chrome for Testing" / headless shell: built for
#                               automation, carries no profile, newest version first
#   3. The system browser     — Chrome, then Canary/Chromium, then Edge
#
# The system browser is ALLOWED, but by default we still hand it a throwaway
# --user-data-dir (see VV_PROFILE_ARG below), so automation never reads or
# mutates your real profile and never collides with a running Chrome.
# Set VV_USE_PROFILE=1 when you deliberately need your logged-in session.
find_browser() {
  # 1. explicit override
  if [ -n "${CHROME_BIN:-}" ] && [ -x "${CHROME_BIN}" ]; then
    printf '%s' "$CHROME_BIN"; return 0
  fi

  local cache d hit
  case "$(uname -s 2>/dev/null || echo Windows)" in
    Darwin) cache="$HOME/Library/Caches/ms-playwright" ;;
    Linux)  cache="$HOME/.cache/ms-playwright" ;;
    *)      cache="${LOCALAPPDATA:-$HOME/AppData/Local}/ms-playwright" ;;
  esac

  # 2. Playwright cache — sort -V puts the highest chromium-<n> last
  if [ -d "$cache" ]; then
    for d in $(ls -1d "$cache"/chromium-* "$cache"/chromium_headless_shell-* 2>/dev/null | sort -V -r); do
      for hit in \
        "$d/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
        "$d/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
        "$d/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium" \
        "$d/chrome-mac/Chromium.app/Contents/MacOS/Chromium" \
        "$d/chrome-headless-shell-mac-arm64/chrome-headless-shell" \
        "$d/chrome-linux/chrome" \
        "$d/chrome-linux/headless_shell" \
        "$d/chrome-win/chrome.exe"
      do
        [ -x "$hit" ] && { printf '%s' "$hit"; return 0; }
      done
    done
  fi

  # 3. system browsers — allowed, but isolated by default
  for hit in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "/c/Program Files/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  do
    [ -x "$hit" ] && { printf '%s' "$hit"; return 0; }
  done
  for hit in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
    if command -v "$hit" >/dev/null 2>&1; then
      printf '%s' "$(command -v "$hit")"; return 0
    fi
  done

  return 1
}

# Isolate the profile unless explicitly told otherwise.
if [ "${VV_USE_PROFILE:-0}" = "1" ]; then
  VV_PROFILE_ARG=""
else
  VV_PROFILE_DIR="$(mktemp -d -t vvprof)"
  VV_PROFILE_ARG="--user-data-dir=$VV_PROFILE_DIR"
  trap 'rm -rf "$VV_PROFILE_DIR"' EXIT
fi

# --- shared flags -----------------------------------------------------------
# --enable-unsafe-swiftshader : software WebGL, else <canvas> 3D renders nothing
# --allow-file-access-from-files : file:// pages loading local modules/assets
# --hide-scrollbars : a scrollbar gutter shifts layout measurements
common_flags() {
  printf '%s\n' \
    --headless=new \
    --disable-gpu \
    --enable-unsafe-swiftshader \
    --hide-scrollbars \
    --allow-file-access-from-files \
    --no-first-run \
    --no-default-browser-check \
    --disable-extensions
  [ -n "$VV_PROFILE_ARG" ] && printf '%s\n' "$VV_PROFILE_ARG"
  return 0
}

to_url() {
  case "$1" in
    http://*|https://*|file://*) printf '%s' "$1" ;;
    /*) printf 'file://%s' "$1" ;;
    *)  printf 'file://%s/%s' "$(pwd)" "$1" ;;
  esac
}

# Copy the page and splice a JS probe in before </body>, so the original is
# never modified. Echoes the temp file path.
with_probe() {
  local src="$1" js="$2" tmp
  tmp="$(mktemp -t vv).html"
  python3 - "$src" "$tmp" "$js" <<'PY'
import io, sys
src, dst, js = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(src, encoding='utf-8', errors='replace').read()
tag = '<script>%s</script>\n</body>' % js
io.open(dst, 'w', encoding='utf-8').write(
    s.replace('</body>', tag) if '</body>' in s else s + tag)
PY
  printf '%s' "$tmp"
}

read_title() {   # run with --dump-dom and extract <title>
  local url="$1" ms="${2:-3000}"
  # shellcheck disable=SC2046
  "$BROWSER" $(common_flags) --virtual-time-budget="$ms" --dump-dom "$url" 2>/dev/null \
    | grep -o '<title>[^<]*</title>' | sed -e 's|<title>||' -e 's|</title>||' | head -1
}

BROWSER="$(find_browser)" || {
  echo "render.sh: no Chromium-family browser found — implement find_browser()" >&2
  exit 1
}
[ -x "$BROWSER" ] || { echo "render.sh: not executable: $BROWSER" >&2; exit 1; }

CMD="${1:-}"; shift || true

case "$CMD" in
  doctor)
    echo "browser: $BROWSER"
    "$BROWSER" --version 2>/dev/null || echo "(--version failed)"
    ;;

  height)
    SRC="${1:?usage: render.sh height <url>}"
    case "$SRC" in http*) echo "height needs a local file" >&2; exit 1 ;; esac
    T="$(with_probe "$SRC" "setTimeout(function(){document.title='H='+document.documentElement.scrollHeight},1500)")"
    read_title "$(to_url "$T")" 2500
    rm -f "$T"
    ;;

  dump)
    # page is expected to set document.title itself (see SKILL.md §4)
    read_title "$(to_url "${1:?usage: render.sh dump <url>}")" "${2:-4000}"
    ;;

  shot)
    SRC="${1:?usage: render.sh shot <url> <out.png> [W] [H] [MS]}"
    OUT="${2:?missing <out.png>}"
    W="${3:-1500}"; H="${4:-1000}"; MS="${5:-3000}"
    # shellcheck disable=SC2046
    "$BROWSER" $(common_flags) \
      --window-size="${W},${H}" \
      --virtual-time-budget="$MS" \
      --screenshot="$OUT" \
      "$(to_url "$SRC")" >/dev/null 2>&1 || true
    if [ -s "$OUT" ]; then
      echo "wrote $OUT (${W}x${H}, ${MS}ms)"
      echo "NOTE: rAF/GSAP animation may be mid-tween — see SKILL.md section 3 before"
      echo "      concluding anything is broken."
    else
      echo "render.sh: screenshot failed or empty: $OUT" >&2; exit 1
    fi
    ;;

  *)
    sed -n '2,12p' "$0"; exit 1 ;;
esac
