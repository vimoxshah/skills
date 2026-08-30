#!/usr/bin/env python3
"""Assert that a theme preserves the house deck's STRUCTURAL grammar.

Written after a real failure: `festival` passed every existing gate — contrast
fine, fonts loaded, chart ramps valid — and still produced a materially worse
deck than the theme it replaced. The gates were all measuring legibility of
individual elements. Nothing measured whether the deck still had structure.

Three assertions, each tied to a mechanism in the template's own CSS:

 1. DECK PUNCTUATION — `.slide.moment` (title/divider) must differ from a content
    slide. Dividers every 4–8 slides are what sections a long deck, and the
    thumbnail rail is where that is read at a glance. Deepening an already-dark
    ground gave 1.04:1 and a 16-slide deck read as one continuous wash.

 2. CARD LIFT — the house recipe is subtle fill + subtle border + big soft
    shadow, where on a LIGHT ground the shadow does the lifting. On a dark ground
    a black shadow is invisible, so the lift must come from fill or border or the
    boxes dissolve.

 3. SEMANTIC EMPHASIS — the template binds `.c-coral`→`--accent2` (a problem) and
    `.c-green`→`--accent3` (a resolution). Taking those from the emphasis order
    made `.c-green` render magenta, so "fixed" markers came out hot pink.

    python3 scripts/check-deck-structure.py [theme]

Exit code is the failure count.
"""
import glob
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))

MOMENT_MIN = 2.5      # moment vs content slide
DARK_BORDER_MIN = 1.6  # dark theme: border vs card
DARK_FILL_MIN = 1.35   # ...or fill vs ground
GREEN_HUE = (85, 195)  # degrees: what ".c-green" must plausibly be

_cr = {"__file__": os.path.join(HERE, "check-ramps.py"), "os": os}
exec(open(os.path.join(HERE, "check-ramps.py")).read().split("def check(")[0], _cr)
h2r, lum, ratio = _cr["h2r"], _cr["lum"], _cr["ratio"]


def hue(hexv):
    r, g, b = (c / 255 for c in h2r(hexv))
    mx, mn = max(r, g, b), min(r, g, b)
    if mx == mn:
        return None
    d = mx - mn
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return h * 60


def compile_deck(theme, pairing):
    out = subprocess.run([sys.executable, os.path.join(HERE, "dk.py"), "compile",
                          theme, pairing, "--surface", "deck"],
                         capture_output=True, text=True).stdout
    d = {}
    for m in re.finditer(r'^\s*(--[\w-]+):([^;]+);', out, re.M):
        d[m.group(1)] = m.group(2).strip()
    return d


def check(only=None):
    """Transcribed themes are ADVISORY, authored themes are BLOCKING.

    For a transcribed theme the authored design is the source of truth — if the
    template's own dark theme has weak dividers, that is a fact about the house
    system for a human to weigh, not something this tool should "correct". Doing
    so would re-introduce the exact failure this gate exists to catch: replacing
    authored values with derived judgment.
    """
    import yaml
    fails, notes, checked = [], [], 0
    for p in sorted(glob.glob(os.path.join(ROOT, "themes", "*.yaml"))):
        if os.path.basename(p).startswith("_"):
            continue
        t = yaml.safe_load(open(p))
        name = t["meta"]["name"]
        if only and name != only:
            continue
        pairing = t["fonts"]["default"]
        transcribed = bool(t["meta"].get("transcribed"))
        sink = notes if transcribed else fails
        tok = compile_deck(name, pairing)
        if not tok:
            fails.append(f"{name}: compile produced no tokens")
            continue
        bg, card = tok.get("--bg"), tok.get("--card")
        light = lum(bg) > 0.18 if bg and bg.startswith("#") else True

        # 1. deck punctuation
        checked += 1
        m = re.search(r'linear-gradient\([^,]+,\s*(#[0-9a-fA-F]{6})', tok.get("--moment-bg", ""))
        if not m:
            sink.append(f"{name}: --moment-bg has no resolvable base colour")
        else:
            r = ratio(bg, m.group(1))
            if r < MOMENT_MIN:
                sink.append(f"{name}: moment vs content only {r:.2f}:1 (< {MOMENT_MIN}) — "
                             "dividers will not read as sections; the deck loses its structure")

        # 2. card lift
        checked += 1
        if light:
            if "rgba" not in tok.get("--shadow", ""):
                sink.append(f"{name}: light theme with no shadow — cards have nothing to lift them")
        else:
            b = ratio(card, tok.get("--border", card)) if card else 0
            f = ratio(bg, card) if card else 0
            if b < DARK_BORDER_MIN and f < DARK_FILL_MIN:
                sink.append(f"{name}: dark theme card lift too weak (border {b:.2f}:1, "
                             f"fill {f:.2f}:1) — a drop shadow cannot rescue this on a dark "
                             "ground, so the boxes dissolve")

        # 3. semantic emphasis
        checked += 1
        a3 = tok.get("--accent3", "")
        if a3.startswith("#"):
            h = hue(a3)
            if h is None or not (GREEN_HUE[0] <= h <= GREEN_HUE[1]):
                sink.append(f"{name}: --accent3 is {a3} (hue {h:.0f}° if defined) — "
                             ".c-green will not read as a resolution/positive marker")
        checked += 1
        a2 = tok.get("--accent2", "")
        if a2.startswith("#") and a3.startswith("#") and a2.lower() == a3.lower():
            sink.append(f"{name}: --accent2 and --accent3 are identical ({a2}) — "
                         "problem and resolution markers are indistinguishable")

    print(f"structural assertions run: {checked}")
    print(f"failures (authored themes — blocking): {len(fails)}")
    for f in fails:
        print("  ✗ " + f)
    print(f"advisories (transcribed themes — the house system's own traits): {len(notes)}")
    for n in notes:
        print("  · " + n)
    return len(fails)


if __name__ == "__main__":
    sys.exit(check(sys.argv[1] if len(sys.argv) > 1 else None))
