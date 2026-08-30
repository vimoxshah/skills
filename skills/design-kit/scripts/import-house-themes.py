#!/usr/bin/env python3
"""Transcribe the house-decks template's OWN built-in themes into design-kit.

Why this exists: the house deck system already carries four hand-tuned themes
(aurora / indigo / boot / keynote). They are the proven look. Re-deriving them
from a 10-token palette produced something that shared a name and nothing else
— a dark purple wash where the real house purple is a LIGHT theme with dark ink
and purple used only as an accent.

So they are transcribed, not re-authored: every token is copied verbatim into a
`deck_tokens:` block that `dk.py` passes straight through. `colors:` /
`emphasis:` are filled from the same real values so the artifact surface and the
chart ramps stay consistent with the deck.

    python3 scripts/import-house-themes.py [--dry-run]

Idempotent: re-running re-reads the template and rewrites the same files, so it
doubles as a drift check if the template's themes are ever retuned.
"""
import argparse
import io
import os
import re
import sys
import textwrap

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(os.path.dirname(ROOT), "house-decks", "template", "deck.html")

# name in template -> (design-kit name, label, contexts, best_for)
MAP = {
    "indigo": ("house-purple", "House Purple",
               "[internal, platform, release, team]",
               "The house look, transcribed from the deck template's own `indigo` "
               "theme. Light content slides, dark moment slides, purple accent "
               "used sparingly. This is the deck identity the existing library "
               "already speaks — the safe default."),
    "aurora": ("house-aurora", "House Aurora",
               "[internal, platform, product, review]",
               "The house blue. Same structure as House Purple with a cyan-blue "
               "accent and amber secondary — calmer, slightly more corporate."),
    "boot": ("house-boot", "House Boot",
             "[internal, engineering, demo, terminal]",
             "The house dark theme. Deep navy ground with cyan accent — the one "
             "built-in theme designed for a dark room and terminal-heavy content."),
    "keynote": ("house-keynote", "House Keynote",
                "[internal, exec, vision, narrative]",
                "The house warm theme. Paper-cream ground, terracotta accent, "
                "green and olive secondaries — reads considered and unhurried."),
}


def parse_block(src, name):
    m = re.search(r':root\[data-theme="%s"\]\{(.*?)\n\s*\}' % name, src, re.S)
    if not m:
        m = re.search(r':root\[data-theme="%s"\]\{(.*?)\}' % name, src, re.S)
    if not m:
        return None
    out = {}
    for decl in m.group(1).split(";"):
        decl = decl.strip()
        if not decl or ":" not in decl:
            continue
        k, v = decl.split(":", 1)
        k = k.strip()
        if k.startswith("--"):
            out[k] = v.strip()
    return out


def yq(v):
    """quote a CSS value for YAML"""
    return '"%s"' % v.replace('"', '\\"')


# ── ramp solving (shares the metrics with scripts/check-ramps.py) ──────────
_CR_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check-ramps.py")
_cr = {"__file__": _CR_PATH, "os": os}
exec(open(_CR_PATH).read().split("def check(")[0], _cr)
h2r, lum, ratio, delta_e = _cr["h2r"], _cr["lum"], _cr["ratio"], _cr["delta_e"]
GROUND_MIN, DELTA_E_MIN = _cr["GROUND_MIN"], _cr["DELTA_E_MIN"]

# hue-distant fillers to draw from when an accent-derived slot collides
POOL = ["#1F6FB2", "#B35C00", "#4C6B2F", "#8A3FA0", "#0F6E6A", "#6A5A8C",
        "#A03050", "#2E6E4F", "#7A4A1F", "#3D4E7A"]


def _fit(hexv, ground, target=3.3):
    """blend away from the ground until the hue clears the contrast floor"""
    toward = [255, 255, 255] if lum(ground) < 0.18 else [0, 0, 0]
    base = h2r(hexv)
    if ratio(hexv, ground) >= target:
        return hexv
    for step in range(1, 101):
        t = step / 100
        cand = "#%02X%02X%02X" % tuple(
            max(0, min(255, round(base[i] + (toward[i] - base[i]) * t))) for i in range(3))
        if ratio(cand, ground) >= target:
            return cand
    return hexv


def solve_categorical(anchors, ground, n=6):
    """Keep the theme's accents (contrast-fitted), then fill to n with
    hue-distant colours, enforcing mutual perceptual separation."""
    out = []
    for a in anchors:
        c = _fit(a, ground)
        if all(delta_e(c, o) >= DELTA_E_MIN for o in out):
            out.append(c)
    for cand in POOL:
        if len(out) >= n:
            break
        c = _fit(cand, ground)
        if ratio(c, ground) >= GROUND_MIN and all(delta_e(c, o) >= DELTA_E_MIN for o in out):
            out.append(c)
    return out[:n]


def solve_sequential(base, ground, n=6):
    """Monotonic lightness ramp from near-ground toward a deep form of the
    accent — direction chosen so it always reads against this ground."""
    dark_ground = lum(ground) < 0.18
    a, b = h2r(base), ([255, 255, 255] if dark_ground else [0, 0, 0])
    start = [round(a[i] + ((0 if dark_ground else 255) - a[i]) * 0.88) for i in range(3)]
    end = [round(a[i] + (b[i] - a[i]) * 0.35) for i in range(3)]
    ramp = []
    for k in range(n):
        t = k / (n - 1)
        ramp.append("#%02X%02X%02X" % tuple(
            max(0, min(255, round(start[i] + (end[i] - start[i]) * t))) for i in range(3)))
    if dark_ground:
        ramp = ramp[::-1] if lum(ramp[0]) > lum(ramp[-1]) else ramp
    else:
        ramp = ramp[::-1] if lum(ramp[0]) < lum(ramp[-1]) else ramp
    return ramp


def build(tokens, tname, dk_name, label, contexts, best_for, is_default):
    bg = tokens.get("--bg", "#ffffff")
    # light if the ground is bright
    def lum(h):
        h = h.strip()
        if not h.startswith("#"):
            return 1.0
        h = h.lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
        f = [c / 12.92 if c <= .03928 else ((c + .055) / 1.055) ** 2.4 for c in (r, g, b)]
        return .2126 * f[0] + .7152 * f[1] + .0722 * f[2]
    mode = "light" if lum(bg) > 0.18 else "dark"

    a1 = tokens.get("--accent", "#000000")
    a2 = tokens.get("--accent2", a1)
    a3 = tokens.get("--accent3", a1)

    L = []
    L.append("# TRANSCRIBED from house-decks/template/deck.html — do NOT hand-edit the")
    L.append("# deck_tokens block. Regenerate with scripts/import-house-themes.py so it")
    L.append("# stays faithful to the template (which is the source of truth).")
    L.append("meta:")
    L.append(f"  name: {dk_name}")
    L.append(f"  label: {label}")
    L.append(f"  default: {'true' if is_default else 'false'}")
    L.append(f"  contexts: {contexts}")
    L.append(f"  modes: [{mode}]")
    L.append("  mood: house / proven")
    L.append(f"  source_of_truth: house-decks/template/deck.html  (data-theme=\"{tname}\")")
    L.append("  transcribed: true")
    L.append("  best_for: >")
    for line in textwrap.wrap(best_for, 74):
        L.append(f"    {line}")
    L.append("")
    L.append("colors:")
    for role, tok in (("ground", "--bg"), ("raise", "--card"), ("sunk", "--bg-soft"),
                      ("ink", "--ink"), ("ink-soft", "--ink-dim"), ("ink-mute", "--ink-mute"),
                      ("rule", "--border"), ("rule-soft", "--border-soft"),
                      ("accent", "--accent"), ("accent-bg", "--accent-soft")):
        v = tokens.get(tok)
        if v is None:
            continue
        key = "ink-faint" if role == "ink-mute" else role
        L.append(f"  {key}: {{{mode}: {yq(v)}}}")
    L.append("")
    L.append("emphasis:")
    L.append(f"  accent: {yq(a1)}")
    L.append(f"  coral: {yq(a2)}      # template's --accent2 (drives .c-coral)")
    L.append(f"  green: {yq(a3)}      # template's --accent3 (drives .c-green)")
    L.append("")
    L.append("semantic:")
    L.append(f"  ok: {yq(a3)}")
    L.append(f"  warn: {yq(a2)}")
    L.append(f"  alert: {yq(a2)}")
    L.append("")
    L.append("fonts:")
    L.append("  default: house-plex")
    L.append("  compatible: [house-plex, space-ibm, archivo-tight, system-stack]")
    L.append("  incompatible:")
    L.append('    anton-archivo: "poster caps are not the house voice — it is a grotesque"')
    L.append('    archivo-black-mono: "poster weight is not the house voice"')
    L.append('    fraunces-archivo: "the house display face is a grotesque, not a serif"')
    L.append('    newsreader-archivo: "the house display face is a grotesque, not a serif"')
    L.append("")
    L.append("rationing:")
    L.append("  max_emphasis_per_slide: 2")
    L.append("  hero_hue: accent")
    L.append("  rule: >")
    L.append("    House behaviour: the accent carries emphasis in headings, --accent2")
    L.append("    (.c-coral) marks problems, --accent3 (.c-green) marks resolutions.")
    L.append("    The ground stays quiet — hierarchy comes from LIGHTNESS, not from")
    L.append("    saturating everything in the accent hue.")
    L.append("")
    # Chart ramps anchored on the theme's own accents, then SOLVED against the
    # gate in check-ramps.py. The raw accents are tuned for text/UI on this
    # ground, not for chart fills — the house teal (#12b3a2) is only 2.46:1 on
    # the light ground, so it would fail legibility as a chart series.
    cats = solve_categorical([a1, a2, a3], bg)
    seq = solve_sequential(a1, bg)
    L.append("charts:")
    L.append("  categorical: [" + ", ".join(yq(c) for c in cats) + "]")
    L.append("  sequential:  [" + ", ".join(yq(c) for c in seq) + "]")
    # good/bad are SEMANTIC and must be unmistakable. Inheriting accent2/accent3
    # fails on warm themes where both happen to be greenish (keynote's green vs
    # olive measured dE 39.2) — so `bad` is solved from a red pool instead.
    good = cats[2]
    bad = next((c for c in (_fit(r, bg) for r in ("#C1121F", "#A83232", "#D94040", "#8E1B1B"))
                if delta_e(c, good) >= 45), _fit("#C1121F", bg))
    L.append(f"  diverging:   [{yq(bad)}, \"#E9A0BE\", \"#E8EAF2\", \"#8FD3CB\", {yq(good)}]")
    L.append(f"  good: {yq(good)}")
    L.append(f"  bad: {yq(bad)}")
    L.append("")
    L.append("# every token below is copied verbatim from the template")
    L.append("deck_tokens:")
    for k, v in tokens.items():
        if k in ("--font", "--display", "--mono"):
            continue          # the font pairing supplies these
        L.append(f"  {k}: {yq(v)}")
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if not os.path.exists(TEMPLATE):
        print(f"template not found: {TEMPLATE}", file=sys.stderr)
        return 1
    src = io.open(TEMPLATE, encoding="utf-8").read()
    wrote = 0
    for tname, (dk_name, label, contexts, best_for) in MAP.items():
        tok = parse_block(src, tname)
        if not tok:
            print(f"  {tname}: block NOT FOUND in template — skipped", file=sys.stderr)
            continue
        is_default = (dk_name == "house-purple")
        y = build(tok, tname, dk_name, label, contexts, best_for, is_default)
        path = os.path.join(ROOT, "themes", f"{dk_name}.yaml")
        print(f"  {tname:<9} -> {os.path.relpath(path, ROOT):<28} "
              f"{len(tok)} tokens verbatim")
        if not a.dry_run:
            io.open(path, "w", encoding="utf-8").write(y)
            wrote += 1
    print(f"\n{'(dry run) ' if a.dry_run else ''}themes written: {wrote}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
