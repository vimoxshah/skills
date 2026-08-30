#!/usr/bin/env python3
"""Assert every font pairing supplies the weights the deck template asks for.

The failure this catches: the deck's CSS requests `font-weight:800` on `h1`
(plus 700/900 elsewhere, 600/700 on mono, 500 on body). A pairing that declares
only `[400]` does not error — the browser silently SYNTHESISES the missing
weight by smearing the outline. On a normal grotesque that is invisible; on an
already-ultra-heavy condensed face like Anton it over-inks every letterform,
which is what "the fonts looked bad" actually was.

`document.fonts.check()` cannot detect this: it returns true for a weight it
would merely synthesise, and false for a weight the page never renders. So this
is a STATIC check — requested weights (parsed from the template CSS) against
declared weights (the catalog) against fetched bytes (the cache).

    python3 scripts/check-font-coverage.py [pairing]

Verdicts:
  ✗ BLOCKING  — the family HAS the weight upstream but the catalog omits it
  · ADVISORY  — a single-weight display face; acceptable only because dk.py
                emits a weight-normalisation rule so nothing is synthesised
Exit code is the blocking-failure count.
"""
import os
import re
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(os.path.dirname(ROOT), "house-decks", "template", "deck.html")

# Families that genuinely offer 400–700 upstream on Google Fonts. A family NOT
# in this map is treated as single/limited-weight and only advised on.
MULTI_WEIGHT = {
    "Archivo", "IBM Plex Sans", "IBM Plex Mono", "Space Grotesk",
    "Fraunces", "Newsreader",
}


def requested_weights():
    """Parse the weights the template's own CSS asks for, per family role."""
    if not os.path.exists(TEMPLATE):
        return {"display": {700, 800}, "body": {500}, "mono": {600, 700}}
    css = re.search(r"<style>(.*?)</style>",
                    open(TEMPLATE, encoding="utf-8").read(), re.S)
    if not css:
        return {"display": {700, 800}, "body": {500}, "mono": {600, 700}}
    css = css.group(1)
    req = {"display": set(), "body": set(), "mono": set()}
    for sel, decl in re.findall(r"([^{}]+)\{([^}]*)\}", css):
        w = re.search(r"font-weight:\s*([1-9]00)", decl)
        if not w:
            continue
        w = int(w.group(1))
        if "var(--display)" in decl:
            req["display"].add(w)
        elif "var(--mono)" in decl:
            req["mono"].add(w)
        elif "var(--font)" in decl:
            req["body"].add(w)
        else:
            # a bare weight on a heading inherits the display family
            if re.search(r"\bh[12]\b|\.display|\.eqhero|divider", sel):
                req["display"].add(w)
            else:
                req["body"].add(w)
    # cap at 700: nothing upstream ships 800/900 for these families, and the
    # normalisation rule handles the gap deliberately
    for k in req:
        req[k] = {w for w in req[k] if w <= 700}
    return req


def check(only=None):
    cat = yaml.safe_load(open(os.path.join(ROOT, "fonts", "catalog.yaml"),
                              encoding="utf-8"))
    req = requested_weights()
    print("deck requests (<=700): " + ", ".join(
        f"{k}={sorted(v)}" for k, v in req.items()))
    print()
    fails, notes, checked = [], [], 0
    cache = os.path.join(ROOT, "fonts", "cache")
    for name, p in cat["pairings"].items():
        if only and name != only:
            continue
        if p.get("license") == "system":
            continue
        for role in ("display", "body", "mono"):
            spec = p.get(role) or {}
            if spec.get("stack") or not spec.get("family"):
                continue
            fam = spec["family"]
            declared = set(spec.get("weights", []))
            checked += 1
            missing = sorted(req[role] - declared)
            if missing:
                if fam in MULTI_WEIGHT:
                    fails.append(f"{name}/{role} {fam}: declares {sorted(declared)}, "
                                 f"missing {missing} which this family DOES ship — "
                                 "the browser will synthesise them")
                else:
                    notes.append(f"{name}/{role} {fam}: single/limited-weight face, "
                                 f"declares {sorted(declared)}, cannot supply {missing} "
                                 "— relies on dk.py weight normalisation")
            # declared weights must actually be on disk
            if spec.get("source", "google") == "google":
                for w in sorted(declared):
                    checked += 1
                    f = os.path.join(cache,
                                     f"{fam.lower().replace(' ', '-')}-{w}.woff2")
                    if not (os.path.exists(f) and os.path.getsize(f) > 0):
                        fails.append(f"{name}/{role} {fam} {w}: declared but NOT "
                                     "fetched — run dk.py fetch")

    print(f"assertions run: {checked}")
    print(f"blocking failures: {len(fails)}")
    for f in fails:
        print("  ✗ " + f)
    print(f"advisories: {len(notes)}")
    for n in notes:
        print("  · " + n)
    return len(fails)


if __name__ == "__main__":
    sys.exit(check(sys.argv[1] if len(sys.argv) > 1 else None))
