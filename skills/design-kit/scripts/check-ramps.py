#!/usr/bin/env python3
"""Validate every theme's chart ramps. This is the gate `references/charts.md`
refers to — run it whenever a theme's `charts` block is authored or edited.

    python3 scripts/check-ramps.py            # all themes
    python3 scripts/check-ramps.py festival   # one theme

Three assertions, each with the RIGHT metric for its job:

 1. Legibility — every categorical hue vs the theme `ground`, as WCAG contrast
    ratio (>= 3.0). Contrast ratio is a LIGHTNESS metric, which is exactly right
    here: the question is whether the mark separates from its background.

 2. Distinctness — every categorical pair, as CIE76 dE in Lab (>= 20). Contrast
    ratio is the WRONG metric for this: #E4572E (orange) and #0F8B8D (teal) sit
    at nearly the same lightness (ratio 1.12) yet are obviously different
    colours. Perceptual distance sees hue; contrast ratio does not.

 3. Order — each sequential ramp must be strictly monotonic in luminance, or it
    encodes nothing once printed in greyscale.

Exit code is the failure count, so it can gate a script.
"""
import glob
import os
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GROUND_MIN = 3.0     # categorical hue vs ground
DELTA_E_MIN = 20.0   # categorical pair separation (CIE76)


def h2r(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def _lin(c):
    c /= 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def lum(h):
    r, g, b = (_lin(c) for c in h2r(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    l1, l2 = lum(a), lum(b)
    return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)


def to_lab(h):
    r, g, b = (_lin(c) for c in h2r(h))
    # sRGB -> XYZ (D65)
    x = r * 0.4124 + g * 0.3576 + b * 0.1805
    y = r * 0.2126 + g * 0.7152 + b * 0.0722
    z = r * 0.0193 + g * 0.1192 + b * 0.9505
    xn, yn, zn = 0.95047, 1.0, 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t) + (16 / 116)
    fx, fy, fz = f(x / xn), f(y / yn), f(z / zn)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def delta_e(a, b):
    la, lb = to_lab(a), to_lab(b)
    return sum((la[i] - lb[i]) ** 2 for i in range(3)) ** 0.5


def check(only=None):
    fails, checked = [], 0
    for p in sorted(glob.glob(os.path.join(ROOT, "themes", "*.yaml"))):
        if os.path.basename(p).startswith("_"):
            continue
        t = yaml.safe_load(open(p))
        name = t["meta"]["name"]
        if only and name != only:
            continue
        mode = t["meta"]["modes"][0]
        g = t["colors"]["ground"]
        ground = g[mode] if isinstance(g, dict) else g
        ch = t.get("charts") or {}
        cats = ch.get("categorical", [])

        for i, hexv in enumerate(cats):
            checked += 1
            r = ratio(hexv, ground)
            if r < GROUND_MIN:
                fails.append(f"{name} categorical[{i}] {hexv} vs ground {ground}: "
                             f"contrast {r:.2f} < {GROUND_MIN}")

        for i in range(len(cats)):
            for j in range(i + 1, len(cats)):
                checked += 1
                d = delta_e(cats[i], cats[j])
                if d < DELTA_E_MIN:
                    fails.append(f"{name} categorical[{i}]/[{j}] {cats[i]}~{cats[j]}: "
                                 f"dE {d:.1f} < {DELTA_E_MIN}")

        seq = ch.get("sequential", [])
        if seq:
            checked += 1
            ls = [lum(x) for x in seq]
            inc = all(ls[i] < ls[i + 1] for i in range(len(ls) - 1))
            dec = all(ls[i] > ls[i + 1] for i in range(len(ls) - 1))
            if not (inc or dec):
                fails.append(f"{name} sequential not monotonic in luminance: "
                             + " ".join(f"{seq[i]}({ls[i]:.3f})" for i in range(len(seq))))

        if ch.get("good") and ch.get("bad"):
            checked += 1
            d = delta_e(ch["good"], ch["bad"])
            if d < 40:
                fails.append(f"{name} good/bad too close: dE {d:.1f} < 40")

    print(f"assertions run: {checked}")
    print(f"failures: {len(fails)}")
    for f in fails:
        print("  " + f)
    return len(fails)


if __name__ == "__main__":
    sys.exit(check(sys.argv[1] if len(sys.argv) > 1 else None))
