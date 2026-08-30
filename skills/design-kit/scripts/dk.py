#!/usr/bin/env python3
"""dk — the design-kit compiler.

Compiles (theme x font-pairing x surface) into ready-to-paste CSS, and
enforces the three rules that cannot be left to prose:

  1. An INCOMPATIBLE theme/pairing pair is refused with the authored reason.
  2. A COMMERCIAL face is never inlined into a shared surface (redistribution).
     The theme's declared `shared_surface_alternate` is substituted instead.
  3. Missing font bytes FAIL CLOSED: the fallback stack is emitted together
     with a visible warning, never a silent substitution. --strict exits 1.

Usage
  dk.py list themes
  dk.py list fonts [--theme NAME]
  dk.py show THEME
  dk.py check THEME PAIRING
  dk.py fetch PAIRING [--all]
  dk.py compile THEME PAIRING --surface deck|artifact [--out FILE] [--strict]
  dk.py manifest
  dk.py assert-fonts THEME PAIRING     # emits the visual-verify __FONTS list

Stdlib + PyYAML only. Font bytes come from the Google Fonts css2 API as
pre-built woff2 (no fonttools/brotli needed).
"""
import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEMES = os.path.join(ROOT, "themes")
FONTS = os.path.join(ROOT, "fonts")
CACHE = os.path.join(FONTS, "cache")
SKILLS = os.path.dirname(ROOT)  # the skills root this skill is installed under

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

SHARED_SURFACES = {"artifact"}  # surfaces that get published/redistributed


# ── loading ───────────────────────────────────────────────────────────────
def load_yaml(path):
    with open(path) as fh:
        return yaml.safe_load(fh)


def load_theme(name):
    p = os.path.join(THEMES, f"{name}.yaml")
    if not os.path.exists(p):
        die(f"unknown theme '{name}'. Available: {', '.join(theme_names())}")
    return load_yaml(p)


def theme_names():
    return sorted(f[:-5] for f in os.listdir(THEMES)
                  if f.endswith(".yaml") and not f.startswith("_"))


def load_catalog():
    return load_yaml(os.path.join(FONTS, "catalog.yaml"))


def load_motion():
    return load_yaml(os.path.join(THEMES, "_motion.yaml"))


def die(msg, code=1):
    print(f"dk: error: {msg}", file=sys.stderr)
    sys.exit(code)


def warn(msg):
    print(f"dk: WARNING: {msg}", file=sys.stderr)


# ── compatibility gate ────────────────────────────────────────────────────
def check_pair(theme_name, pairing_name, surface=None, quiet=False):
    """Returns (ok, effective_pairing, messages). Never raises on a bad pair."""
    theme = load_theme(theme_name)
    cat = load_catalog()
    msgs = []

    if pairing_name not in cat["pairings"]:
        die(f"unknown pairing '{pairing_name}'. Available: "
            f"{', '.join(sorted(cat['pairings']))}")

    fonts = theme.get("fonts", {})
    compatible = fonts.get("compatible", [])
    incompatible = fonts.get("incompatible", {}) or {}

    if pairing_name in incompatible:
        reason = incompatible[pairing_name]
        msgs.append(f"REFUSED  {theme_name} x {pairing_name}\n         reason: {reason}")
        alt = fonts.get("default")
        msgs.append(f"         compatible instead: {', '.join(compatible)}")
        msgs.append(f"         theme default: {alt}")
        return False, None, msgs

    if compatible and pairing_name not in compatible:
        msgs.append(f"REFUSED  {theme_name} x {pairing_name}\n"
                    f"         reason: not in this theme's compatible list")
        msgs.append(f"         compatible: {', '.join(compatible)}")
        return False, None, msgs

    pairing = cat["pairings"][pairing_name]
    effective = pairing_name

    # rule 2: commercial face never reaches a shared surface
    if surface in SHARED_SURFACES:
        if pairing.get("license") == "COMMERCIAL" or pairing.get("redistributable") is False:
            alt = fonts.get("shared_surface_alternate") or "system-stack"
            msgs.append(
                f"SUBSTITUTED  '{pairing_name}' is a COMMERCIAL face; inlining it into "
                f"a '{surface}' surface would be redistribution.\n"
                f"             Using '{alt}' instead (theme's declared "
                f"shared_surface_alternate).")
            effective = alt
        elif surface not in pairing.get("surfaces", []):
            msgs.append(f"REFUSED  pairing '{pairing_name}' does not declare surface "
                        f"'{surface}' (declares: {', '.join(pairing.get('surfaces', []))})")
            return False, None, msgs
    elif surface and surface not in pairing.get("surfaces", []):
        msgs.append(f"REFUSED  pairing '{pairing_name}' does not declare surface "
                    f"'{surface}' (declares: {', '.join(pairing.get('surfaces', []))})")
        return False, None, msgs

    if not msgs:
        msgs.append(f"OK       {theme_name} x {pairing_name}"
                    + (f"  (surface: {surface})" if surface else ""))
    return True, effective, msgs


# ── font fetching ─────────────────────────────────────────────────────────
def _http(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read()
    return data if binary else data.decode("utf-8")


def gfonts_meta():
    """Real license data, fetched once and cached — not from recall."""
    p = os.path.join(CACHE, "_gfonts-meta.json")
    if os.path.exists(p):
        try:
            with open(p) as fh:
                return json.load(fh)
        except Exception:
            pass
    try:
        raw = _http("https://fonts.google.com/metadata/fonts")
        raw = raw.lstrip(")]}'\n")  # google prefixes an anti-JSON-hijack guard
        meta = json.loads(raw)
        os.makedirs(CACHE, exist_ok=True)
        with open(p, "w") as fh:
            json.dump(meta, fh)
        return meta
    except Exception as e:
        warn(f"could not fetch Google Fonts metadata ({e}); licenses unverified")
        return None


def license_for(family, meta):
    """Verified embeddability from LIVE metadata, never from recall.

    The Google Fonts metadata API exposes no literal license string; the
    authoritative field is the boolean `isOpenSource`. So we report what the
    API actually asserts and let the manifest compare it against the license
    the catalog *declares* — a mismatch is then visible rather than assumed.
    """
    if not meta:
        return "UNVERIFIED (metadata fetch failed)"
    for fam in meta.get("familyMetadataList", []):
        if fam.get("family", "").lower() == family.lower():
            if fam.get("isOpenSource") is True:
                return "OSS-VERIFIED"
            if fam.get("isOpenSource") is False:
                return "NOT-OSS — do not inline"
            return "UNVERIFIED (no isOpenSource field)"
    return "NOT-IN-GOOGLE-CATALOG"


def face_filename(family, weight):
    return f"{family.lower().replace(' ', '-')}-{weight}.woff2"


def fetch_face(family, weight):
    """Fetch one weight's latin woff2. Returns (path, bytes) or (None, 0)."""
    os.makedirs(CACHE, exist_ok=True)
    out = os.path.join(CACHE, face_filename(family, weight))
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return out, os.path.getsize(out)

    fam_url = family.replace(" ", "+")
    urls = [f"https://fonts.googleapis.com/css2?family={fam_url}:wght@{weight}&display=swap",
            f"https://fonts.googleapis.com/css2?family={fam_url}&display=swap"]
    css = None
    for u in urls:
        try:
            css = _http(u)
            break
        except urllib.error.HTTPError:
            continue
        except Exception as e:
            warn(f"fetch failed for {family} {weight}: {e}")
            return None, 0
    if not css:
        warn(f"no CSS from Google Fonts for {family} {weight}")
        return None, 0

    # css2 groups @font-face blocks under /* subset */ comments. Keep latin.
    latin = None
    for block in re.split(r"/\*\s*([\w-]+)\s*\*/", css)[1:]:
        pass
    parts = re.split(r"/\*\s*([\w-]+)\s*\*/", css)
    # parts = [pre, name1, body1, name2, body2, ...]
    for i in range(1, len(parts) - 1, 2):
        if parts[i].strip() == "latin":
            latin = parts[i + 1]
            break
    body = latin or css
    m = re.search(r"url\((https://[^)]+\.woff2)\)", body)
    if not m:
        warn(f"no woff2 url found for {family} {weight}")
        return None, 0
    try:
        data = _http(m.group(1), binary=True)
    except Exception as e:
        warn(f"woff2 download failed for {family} {weight}: {e}")
        return None, 0
    with open(out, "wb") as fh:
        fh.write(data)
    return out, len(data)


# Weight -> the style names a foundry actually ships in filenames. Matching on
# the family stem alone once picked the Bold file for EVERY weight, which
# silently rendered a whole local-face deck in bold — hence explicit weight names.
WEIGHT_NAMES = {
    100: ("thin", "hairline"), 200: ("extralight", "ultralight"),
    300: ("light",), 400: ("regular", "book", "normal"),
    500: ("medium",), 600: ("semibold", "demibold"),
    700: ("bold",), 800: ("extrabold", "ultrabold"), 900: ("black", "heavy"),
}


def _match_local_face(directory, family, weight):
    """Find the file for THIS family at THIS weight. Never falls back to a
    different weight — a wrong-weight match is worse than a fallback stack
    because it looks intentional."""
    if not os.path.isdir(directory):
        return None
    stem = family.replace(" ", "").lower()
    names = WEIGHT_NAMES.get(int(weight), ())
    cands = [f for f in sorted(os.listdir(directory))
             if f.lower().endswith((".ttf", ".otf", ".woff2"))
             and stem[:6] in f.lower().replace("-", "").replace(" ", "")]
    # exclude italics unless asked; match the weight name as a token
    for f in cands:
        base = f.lower().rsplit(".", 1)[0].replace("-", " ").replace("_", " ")
        if "italic" in base or "oblique" in base:
            continue
        toks = base.split()
        for n in names:
            if n in toks or any(t == n for t in toks):
                return f
    # weight 400 is often unsuffixed (e.g. "Anton.ttf")
    if int(weight) == 400:
        for f in cands:
            base = f.lower().rsplit(".", 1)[0].replace("-", " ")
            if base.replace(" ", "") == stem and "italic" not in base:
                return f
    return None


def pairing_faces(pairing):
    """Yield (role, family, weight, source, local_dir) for real (non-stack) faces."""
    for role in ("display", "body", "mono"):
        spec = pairing.get(role) or {}
        if spec.get("stack"):
            continue
        fam = spec.get("family")
        if not fam:
            continue
        for w in spec.get("weights", [400]):
            yield role, fam, w, spec.get("source", "google"), spec.get("local_dir")


def cmd_fetch(args):
    cat = load_catalog()
    names = sorted(cat["pairings"]) if args.all else [args.pairing]
    meta = gfonts_meta()
    total = 0
    rows = []
    for name in names:
        p = cat["pairings"][name]
        if p.get("license") == "system":
            print(f"{name}: system stacks, 0 bytes, nothing to fetch")
            continue
        for role, fam, w, source, local_dir in pairing_faces(p):
            if source == "local":
                lp = os.path.join(SKILLS, local_dir or "", "")
                found = None
                if local_dir and os.path.isdir(os.path.join(SKILLS, local_dir)):
                    for f in os.listdir(os.path.join(SKILLS, local_dir)):
                        if f.lower().endswith((".ttf", ".otf", ".woff2")):
                            found = f
                            break
                status = "present" if found else "MISSING"
                rows.append((name, role, fam, w, "local", 0, "n/a (local file)",
                             status, p.get("license")))
                print(f"{name}/{role} {fam} {w}: local ({status}) dir={local_dir}")
                continue
            path, n = fetch_face(fam, w)
            total += n
            lic = license_for(fam, meta)
            rows.append((name, role, fam, w, "google", n, lic,
                         "ok" if path else "FAILED", p.get("license")))
            print(f"{name}/{role} {fam} {w}: {n} bytes  license={lic}"
                  + ("" if path else "  FAILED"))
    print(f"\ntotal fetched this run: {total} bytes")
    write_manifest(rows)
    return 0


def write_manifest(rows):
    """LICENSES.md records what was ACTUALLY downloaded, per face."""
    p = os.path.join(FONTS, "LICENSES.md")
    prev = ""
    if os.path.exists(p):
        with open(p) as fh:
            prev = fh.read()
    lines = ["# Font license manifest",
             "",
             "Generated by `dk.py fetch` / `dk.py manifest` from what was **actually",
             "downloaded**. The `Verified` column is what the live Google Fonts",
             "metadata API asserts (`isOpenSource`); `Declared` is what this repo's",
             "`catalog.yaml` claims. **A mismatch between the two is a bug to fix,",
             "not a rounding error** — that comparison is the whole point of this file.",
             "",
             "| Pairing | Role | Family | Weight | Source | Bytes | Declared | Verified | Status |",
             "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    seen = set()
    mismatches = []
    for r in rows:
        key = (r[0], r[1], r[2], r[3])
        if key in seen:
            continue
        seen.add(key)
        declared = r[8] if len(r) > 8 else "?"
        verified = r[6]
        flag = ""
        if declared == "OFL-1.1" and verified not in ("OSS-VERIFIED", "system"):
            flag = " ⚠"
            mismatches.append(f"{r[2]}: declared {declared}, API says {verified}")
        lines.append(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | "
                     f"{r[5] or ''} | {declared} | {verified}{flag} | {r[7]} |")
    lines += ["",
              "## Policy (enforced in code, not prose)",
              "",
              "- **OSS-VERIFIED** — the API asserts open source. Embeddable anywhere,",
              "  including data-URI inlining into a published artifact.",
              "- **COMMERCIAL / NOT-OSS** — `dk.py compile --surface artifact` REFUSES",
              "  to inline these and substitutes the theme's `shared_surface_alternate`.",
              "  A local deck referencing the files in place is not redistribution.",
              "- **UNVERIFIED / NOT-IN-GOOGLE-CATALOG** — treat as unknown. Do not",
              "  inline into anything shared until a human confirms the terms.",
              ""]
    if mismatches:
        lines += ["## ⚠ Declared/verified mismatches", ""]
        lines += [f"- {m}" for m in mismatches] + [""]
    if prev and "manually verified" in prev:
        lines.append("> Note: a previous manifest carried manual verification notes; "
                     "re-add them if still true.")
    with open(p, "w") as fh:
        fh.write("\n".join(lines))
    print(f"wrote {p}")


# ── css emission ──────────────────────────────────────────────────────────
def stack_for(catalog, spec):
    if spec.get("stack"):
        return catalog["stacks"][spec["stack"]]
    fb = catalog["stacks"].get(spec.get("fallback", "sans"), catalog["stacks"]["sans"])
    return f"'{spec['family']}',{fb}"


def font_faces_css(catalog, pairing, surface, strict):
    """Returns (css, warnings, families_used)."""
    out, warns, fams = [], [], []
    for role in ("display", "body", "mono"):
        spec = pairing.get(role) or {}
        if spec.get("stack"):
            continue
        fam = spec.get("family")
        if not fam:
            continue
        src = spec.get("source", "google")
        for w in spec.get("weights", [400]):
            if src == "local":
                # decks reference local files in place; never inlined
                ld = spec.get("local_dir", "")
                cand = _match_local_face(os.path.join(SKILLS, ld), fam, w)
                if not cand:
                    warns.append(f"{fam} {w}: no local file for weight {w} in {ld}"
                                 " -> falling back to stack")
                    continue
                out.append(f"@font-face{{font-family:'{fam}';"
                           f"src:url('fonts/{cand}');font-weight:{w};"
                           "font-style:normal;font-display:swap}")
                fams.append((fam, w))
                continue

            path = os.path.join(CACHE, face_filename(fam, w))
            if not (os.path.exists(path) and os.path.getsize(path) > 0):
                warns.append(f"{fam} {w}: no cached bytes "
                             f"(run: dk.py fetch <pairing>) -> falling back to stack")
                continue
            if surface == "deck":
                out.append(f"@font-face{{font-family:'{fam}';"
                           f"src:url('fonts/{face_filename(fam, w)}') format('woff2');"
                           f"font-weight:{w};font-style:normal;font-display:swap}}")
            else:
                b64 = base64.b64encode(open(path, "rb").read()).decode()
                out.append(f"@font-face{{font-family:'{fam}';"
                           f"src:url(data:font/woff2;base64,{b64}) format('woff2');"
                           f"font-weight:{w};font-style:normal;font-display:swap}}")
            fams.append((fam, w))
    return "\n".join(out), warns, fams


def mode_value(val, mode, modes):
    """colors are role -> {mode: value}; single-mode themes have one key."""
    if isinstance(val, dict):
        if mode in val:
            return val[mode]
        return val[modes[0]]
    return val


def token_block(theme, catalog, pairing, mode, motion, include_motion=True):
    t = []
    modes = theme["meta"]["modes"]
    for role, val in theme["colors"].items():
        t.append(f"  --dk-{role}:{mode_value(val, mode, modes)};")
    for name, hexv in (theme.get("emphasis") or {}).items():
        t.append(f"  --dk-c-{name}:{hexv};")
    for name, hexv in (theme.get("siblings") or {}).items():
        t.append(f"  --dk-product-{name}:{hexv};")
    for name, hexv in (theme.get("semantic") or {}).items():
        t.append(f"  --dk-{name}:{hexv};")
    for role in ("display", "body", "mono"):
        spec = pairing.get(role) or {}
        t.append(f"  --dk-font-{role}:{stack_for(catalog, spec)};")
        if spec.get("tracking"):
            t.append(f"  --dk-track-{role}:{spec['tracking']};")
        if spec.get("transform"):
            t.append(f"  --dk-transform-{role}:{spec['transform']};")
    if include_motion:
        d, e, s = motion["durations"], motion["easings"], motion["stagger"]
        t += [f"  --mo-fast:{d['fast']};", f"  --mo-base:{d['base']};",
              f"  --mo-slow:{d['slow']};", f"  --mo-ease:{e['ease']};",
              f"  --mo-ease-out:{e['ease-out']};", f"  --mo-stagger:{s['step']};"]
    return "\n".join(t)


def _hex2rgb(h):
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _is_hex(v):
    return isinstance(v, str) and v.strip().startswith("#")


def _rgba(v, a):
    """alpha variant; passes non-hex values (rgba/gradients) through unchanged"""
    if not _is_hex(v):
        return v
    r, g, b = _hex2rgb(v)
    return f"rgba({r},{g},{b},{a})"


def _mix(v, toward, t):
    """blend v toward another color by t (0..1)"""
    if not _is_hex(v):
        return v
    a, b = _hex2rgb(v), _hex2rgb(toward)
    r, g, bl = (round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return f"#{r:02x}{g:02x}{bl:02x}"


def _shift(v, f):
    """f<1 darkens, f>1 lightens (clamped)"""
    if not _is_hex(v):
        return v
    r, g, b = (max(0, min(255, round(c * f))) for c in _hex2rgb(v))
    return f"#{r:02x}{g:02x}{b:02x}"


def deck_theme_block(theme, catalog, pairing, motion):
    """Emit a drop-in `:root[data-theme="<name>"]` block using the EXACT token
    names house-decks/template/deck.html consumes, so a deck opts in with one
    attribute and every existing class keeps working.

    **`deck_tokens` in the theme wins over everything below.** A theme that
    mirrors a hand-tuned design carries its values verbatim, because derived
    values are not equivalent to authored ones: the house themes use a
    purple-tinted shadow (`rgba(40,30,90,.14)`), a specific two-stop moment
    gradient, and light grounds with dark ink — none of which a formula
    reproduces. Derivation below is the FALLBACK for themes authored here.

    Verified against the template's own theme blocks (aurora/indigo/boot/
    keynote): --bg/--bg-soft/--bg-tint/--card, --ink/--ink-dim/--ink-mute,
    --border/--border-soft, --accent{,-deep,-soft,-line}, --accent2{,-soft,
    -line}, --accent3{,-soft,-line}, --shadow{,-sm}, --moment-*, --term-*.
    """
    name = theme["meta"]["name"]
    modes = theme["meta"]["modes"]
    mode = modes[0]

    # verbatim path — authored values pass through untouched
    if theme.get("deck_tokens"):
        rows = dict(theme["deck_tokens"])
        for role, key in (("display", "--display"), ("body", "--font"), ("mono", "--mono")):
            spec = pairing.get(role) or {}
            rows[key] = stack_for(catalog, spec)
        d, e, s = motion["durations"], motion["easings"], motion["stagger"]
        rows.update({"--mo-fast": d["fast"], "--mo-base": d["base"],
                     "--mo-slow": d["slow"], "--mo-ease": e["ease"],
                     "--mo-ease-out": e["ease-out"], "--mo-stagger": s["step"]})
        body = "\n".join(f"  {k}:{v};" for k, v in rows.items())
        return (f'/* verbatim deck_tokens — authored, not derived */\n'
                f':root[data-theme="{name}"]{{\n{body}\n}}')

    C = {k: mode_value(v, mode, modes) for k, v in theme["colors"].items()}
    emph = list((theme.get("emphasis") or {}).values())
    sem = theme.get("semantic") or {}
    a1 = C["accent"]
    # --accent2 / --accent3 are SEMANTIC in the house grammar: the template binds
    # .c-coral -> --accent2 (a problem) and .c-green -> --accent3 (a resolution).
    # Taking them from emphasis[1]/[2] made .c-green render magenta on festival —
    # "fixed" markers came out hot pink. Bind them to the semantic block instead,
    # falling back to the emphasis order only when a theme declares no semantics.
    a2 = sem.get("alert") or sem.get("warn") or (emph[1] if len(emph) > 1 else a1)
    a3 = sem.get("ok") or (emph[2] if len(emph) > 2 else a1)
    light = mode == "light"

    # Moment slides (title/divider) are the deck's PUNCTUATION — dividers every
    # 4–8 slides are what gives a long deck structure, and the thumbnail rail is
    # where that structure is read at a glance.
    #
    # Deepening a dark ground made moments identical to content: measured
    # 1.04:1 moment-vs-content on festival, against 16.68:1 on the house theme,
    # so a 16-slide deck read as one continuous wash with no sections. On a dark
    # theme the moment must therefore go *lighter* (a lifted, saturated panel),
    # not darker — the direction that actually produces a change of register.
    m_base = _mix(C["raise"], a1, .22) if not light else C["ink"]
    m_base2 = _mix(C["sunk"], a1, .10) if not light else _shift(C["ink"], 1.6)
    if not light:
        m_base = _shift(m_base, 1.55)
        m_base2 = _shift(m_base2, 1.25)
    m_ink = C["ink"] if not light else C["ground"]
    m_dim = _rgba(m_ink, .78)
    m_mute = _rgba(m_ink, .52)
    shadow_a = ".5" if not light else ".14"

    # Card lift: the house recipe is a subtle fill step + a subtle border + a big
    # soft shadow — and on a light ground the SHADOW does the lifting. Ported to a
    # dark ground that recipe collapses: a black shadow over near-black is
    # invisible, leaving fill 1.10:1 and border 1.22:1, so boxes dissolved. On a
    # dark theme the lift has to come from the fill and border instead.
    card = C["raise"] if light else _shift(C["raise"], 1.34)
    border = C["rule"] if light else _mix(_shift(C["rule"], 1.5), a1, .16)
    rows = {
        "--bg": C["ground"], "--bg-soft": C["raise"],
        "--bg-tint": _shift(C["raise"], 1.04 if not light else .98),
        "--card": card,
        "--ink": C["ink"], "--ink-dim": C["ink-soft"], "--ink-mute": C["ink-faint"],
        "--border": border,
        "--border-soft": C["rule-soft"] if light else _shift(C["rule-soft"], 1.4),
        "--accent": a1, "--accent-deep": _shift(a1, .82),
        "--accent-soft": C.get("accent-bg") or _rgba(a1, .12),
        "--accent-line": _rgba(a1, .34),
        "--accent2": a2, "--accent2-soft": _rgba(a2, .13), "--accent2-line": _rgba(a2, .38),
        "--accent3": a3, "--accent3-soft": _rgba(a3, .13), "--accent3-line": _rgba(a3, .40),
        # a dark theme also gets a top rim-light, because a drop shadow cannot
        # read against a near-black ground
        "--shadow": (f"0 22px 60px rgba(0,0,0,{shadow_a})" if light else
                     f"inset 0 1px 0 rgba(255,255,255,.07), 0 22px 60px rgba(0,0,0,{shadow_a})"),
        "--shadow-sm": (f"0 8px 24px rgba(0,0,0,{shadow_a})" if light else
                        f"inset 0 1px 0 rgba(255,255,255,.05), 0 8px 24px rgba(0,0,0,{shadow_a})"),
        "--moment-bg": (
            f"radial-gradient(1200px 680px at 88% -14%,{_rgba(a1, .38)},transparent 56%),"
            f"radial-gradient(840px 520px at 2% 118%,{_rgba(a2, .18)},transparent 58%),"
            f"linear-gradient(155deg,{m_base} 0%,{m_base2} 100%)"),
        "--moment-ink": m_ink, "--moment-dim": m_dim, "--moment-mute": m_mute,
        "--moment-accent": _shift(a1, 1.18) if not light else a1,
        "--moment-card": _rgba(m_ink, .06), "--moment-border": _rgba(m_ink, .15),
        # A terminal is a DARK surface even inside a light theme — that is the
        # convention, and deriving it from the light `sunk` token produced light
        # ink on a light ground (1.55:1, unreadable). Verified by the contrast
        # gate on the generated showcase.
        "--term-bg": _shift(C["sunk"], .85) if not light else C["ink"],
        "--term-head": _shift(C["raise"], .8) if not light else _shift(C["ink"], 1.55),
        "--term-ink": m_ink if not light else C["ground"],
        "--term-dim": _rgba(m_ink if not light else C["ground"], .68),
        # The terminal surface inverts relative to a light theme, so it needs
        # its OWN accent: the theme accent is chosen to read on the theme
        # ground, and on a dark terminal it goes dark-on-dark (measured 1.65:1
        # for a light+dark dual-mode theme). Lighten it toward white for light themes.
        "--term-accent": (_shift(a1, 1.18) if not light else _mix(a1, "#FFFFFF", .55)),
        # type
        "--font": stack_for(catalog, pairing.get("body") or {}),
        "--display": stack_for(catalog, pairing.get("display") or {}),
        "--mono": stack_for(catalog, pairing.get("mono") or {}),
    }
    d, e, s = motion["durations"], motion["easings"], motion["stagger"]
    rows.update({"--mo-fast": d["fast"], "--mo-base": d["base"], "--mo-slow": d["slow"],
                 "--mo-ease": e["ease"], "--mo-ease-out": e["ease-out"],
                 "--mo-stagger": s["step"]})
    body = "\n".join(f"  {k}:{v};" for k, v in rows.items())
    return f':root[data-theme="{name}"]{{\n{body}\n}}'

ARTIFACT_ALIASES = """
/* ── host aliases: html-artifact documented token names ───────────────── */
:root{
  --ground:var(--dk-ground); --raise:var(--dk-raise); --sunk:var(--dk-sunk);
  --ink:var(--dk-ink); --ink-soft:var(--dk-ink-soft); --ink-faint:var(--dk-ink-faint);
  --rule:var(--dk-rule); --rule-soft:var(--dk-rule-soft);
  --accent:var(--dk-accent); --accent-bg:var(--dk-accent-bg);
  --warn:var(--dk-warn); --alert:var(--dk-alert);
  --sans:var(--dk-font-body); --mono:var(--dk-font-mono); --serif:var(--dk-font-display);
}
"""


def weight_normalisation(theme, catalog, pairing_name, pairing):
    """Stop the browser synthesising weights a display face does not have.

    The deck's CSS asks for `font-weight:800` on `h1` (and 700/900 elsewhere).
    A multi-weight grotesque like Space Grotesk covers 700 and synthesises 800
    subtly enough that nobody notices. A SINGLE-weight ultra-heavy condensed
    face like Anton has only 400 — so the browser fakes the extra weight by
    smearing the outline, over-inking letterforms that were already dense. That
    is what "the fonts looked bad in festival" actually was.

    So when the display face cannot supply the heavy weights the template
    requests, pin the display selectors to the weight that genuinely exists.
    """
    spec = pairing.get("display") or {}
    if spec.get("stack") or not spec.get("family"):
        return ""
    weights = sorted(spec.get("weights", []) or [400])
    if max(weights) >= 700:
        return ""                      # the face can carry the request
    w = max(weights)
    name = theme["meta"]["name"]
    sel = ", ".join(f'[data-theme="{name}"] {s}' for s in
                    ("h1", "h2", ".display", ".eqhero", ".box-hero", ".divider-idx"))
    return (f"/* '{spec['family']}' ships only weight(s) {weights}, but the deck\n"
            f"   requests up to 800 on display selectors. Pin them so the browser\n"
            f"   renders the real face instead of a synthesised faux-bold. */\n"
            f"{sel} {{ font-weight: {w}; }}")


def emphasis_classes(theme, surface):
    """The c-* contract from house-decks/references/grammar.md, generated.

    The deck template already ships .c-accent/.c-coral/.c-green bound to
    --accent/--accent2/--accent3, so those keep working untouched. These add
    the theme's own NAMED hues (.c-gold, .c-mint, …) so markup can say what it
    means instead of which slot it happens to occupy.
    """
    rows = [f".c-{n}{{color:var(--dk-c-{n})}}" for n in (theme.get("emphasis") or {})]
    for n in (theme.get("siblings") or {}):
        rows.append(f".c-product-{n}{{color:var(--dk-product-{n})}}")
    return ("/* named emphasis spans — use these, never raw hex in markup.\n"
            "   The template's .c-accent/.c-coral/.c-green still work. */\n"
            + "\n".join(rows))


def cmd_compile(args):
    ok, effective, msgs = check_pair(args.theme, args.pairing, args.surface)
    for m in msgs:
        print(f"dk: {m}", file=sys.stderr)
    if not ok:
        die("refused — pick a compatible pairing (see above)")

    theme = load_theme(args.theme)
    catalog = load_catalog()
    motion = load_motion()
    pairing = catalog["pairings"][effective]
    modes = theme["meta"]["modes"]

    faces, fwarns, fams = font_faces_css(catalog, pairing, args.surface, args.strict)
    for w in fwarns:
        warn(w)

    head = [f"/* design-kit — theme:{args.theme} pairing:{effective} "
            f"surface:{args.surface} */",
            f"/* modes:{','.join(modes)} · mood:{theme['meta'].get('mood','')} */"]
    if effective != args.pairing:
        head.append(f"/* NOTE: requested pairing '{args.pairing}' was substituted "
                    f"-> '{effective}' (license policy) */")
    if fwarns:
        head.append("/* !! FONT FALLBACK IN EFFECT — this page is NOT rendering its")
        head.append("   intended typeface. Reasons: */")
        head += [f"/*   - {w} */" for w in fwarns]

    parts = ["\n".join(head)]
    if faces:
        parts.append(faces)

    if args.scope:
        # Embed one theme in PART of a page (showcase, side-by-side comparison).
        # Scoping is orthogonal to surface: --surface picks how fonts are
        # delivered (local file vs data URI), --scope picks where tokens apply.
        parts.append(f"/* ── scoped theme block for: {args.scope} ── */")
        blk = deck_theme_block(theme, catalog, pairing, motion)
        blk = blk.replace(f':root[data-theme="{theme["meta"]["name"]}"]', args.scope, 1)
        parts.append(blk)
        scoped_emph = "\n".join(
            f"{args.scope} .c-{n}{{color:var(--dk-c-{n})}}"
            for n in (theme.get("emphasis") or {}))
        tok = token_block(theme, catalog, pairing, modes[0], motion)
        parts.append(f"{args.scope}{{\n{tok}\n}}")
        if scoped_emph:
            parts.append(scoped_emph)
    elif args.surface == "deck":
        primary = modes[0]
        # canonical --dk-* tokens (cross-surface), then the drop-in deck block
        parts.append(":root{\n" + token_block(theme, catalog, pairing, primary, motion) + "\n}")
        parts.append(f'/* ── drop-in deck theme: set <html data-theme="{args.theme}"> ── */')
        parts.append(deck_theme_block(theme, catalog, pairing, motion))
        parts.append(emphasis_classes(theme, "deck"))
        wn = weight_normalisation(theme, catalog, effective, pairing)
        if wn:
            parts.append(wn)
        r = theme.get("rationing") or {}
        parts.append(
            f"/* RATIONING (theme discipline, enforced by review not CSS):\n"
            f"   max {r.get('max_emphasis_per_slide','?')} emphasis hue(s) per slide"
            f" · hero hue: {r.get('hero_hue','?')}\n"
            f"   {(r.get('rule') or '').strip()} */")
    else:
        # html-artifact three-layer block
        if len(modes) == 1:
            m = modes[0]
            parts.append(f"/* single-mode theme ({m}) — committed on purpose. No")
            parts.append("   auto-inversion: every color is painted explicitly so the")
            parts.append("   page holds on either host ground. */")
            parts.append(":root{\n" + token_block(theme, catalog, pairing, m, motion) + "\n}")
        else:
            parts.append("/* layer 1: complete light palette on bare :root */")
            parts.append(":root{\n" + token_block(theme, catalog, pairing, "light", motion) + "\n}")
            dark = token_block(theme, catalog, pairing, "dark", motion, include_motion=False)
            parts.append("/* layer 2: dark via media query, guarded so an explicit\n"
                         "   light choice still wins */")
            parts.append("@media (prefers-color-scheme:dark){\n"
                         ':root:not([data-theme="light"]){\n' + dark + "\n}}")
            parts.append("/* layer 3: the toggle wins in both directions */")
            parts.append(':root[data-theme="dark"]{\n' + dark + "\n}")
            parts.append(':root[data-theme="light"]{\n'
                         + token_block(theme, catalog, pairing, "light", motion,
                                       include_motion=False) + "\n}")
        parts.append(ARTIFACT_ALIASES.strip())
        parts.append(emphasis_classes(theme, "artifact"))
        parts.append("/* body must paint an explicit ground — a transparent body\n"
                     "   borrows the host's theme */\nbody{background:var(--ground);"
                     "color:var(--ink)}")

    css = "\n\n".join(parts) + "\n"
    if args.out:
        with open(args.out, "w") as fh:
            fh.write(css)
        print(f"wrote {args.out} ({len(css)} bytes)", file=sys.stderr)
    else:
        sys.stdout.write(css)

    if fwarns and args.strict:
        die("--strict: font bytes missing, refusing to report success", 2)
    return 0


def cmd_assert_fonts(args):
    """Emit the __FONTS list visual-verify's fontload check consumes."""
    ok, effective, _ = check_pair(args.theme, args.pairing, args.surface)
    if not ok:
        die("incompatible pair")
    catalog = load_catalog()
    pairing = catalog["pairings"][effective]
    shorthands = []
    for role in ("display", "body", "mono"):
        spec = pairing.get(role) or {}
        if spec.get("stack") or not spec.get("family"):
            continue
        for w in spec.get("weights", [400]):
            shorthands.append(f"{w} 16px \"{spec['family']}\"")
    print("<script>window.__FONTS=" + json.dumps(shorthands) + ";</script>")
    return 0


# ── listing ───────────────────────────────────────────────────────────────
def cmd_list(args):
    if args.what == "themes":
        print(f"{'THEME':<18}{'MODES':<14}{'DEFAULT FONT':<20}{'CONTEXTS'}")
        for n in theme_names():
            t = load_theme(n)
            m = t["meta"]
            star = " *" if m.get("default") else ""
            print(f"{n + star:<18}{','.join(m['modes']):<14}"
                  f"{t['fonts']['default']:<20}{','.join(m.get('contexts', []))}")
        print("\n* = default theme.")
    else:
        cat = load_catalog()
        if args.theme:
            t = load_theme(args.theme)
            f = t["fonts"]
            print(f"pairings for theme '{args.theme}' (default: {f['default']}):\n")
            for p in f.get("compatible", []):
                d = cat["pairings"][p]
                mark = " (default)" if p == f["default"] else ""
                print(f"  OK  {p:<20}{d['mood']}{mark}")
            for p, why in (f.get("incompatible") or {}).items():
                print(f"  --  {p:<20}refused: {why}")
        else:
            print(f"{'PAIRING':<22}{'LICENSE':<13}{'MOOD'}")
            for p, d in cat["pairings"].items():
                print(f"{p:<22}{str(d.get('license')):<13}{d.get('mood','')}")
    return 0


def cmd_show(args):
    t = load_theme(args.theme)
    print(yaml.safe_dump(t, sort_keys=False, width=100))
    return 0


def cmd_check(args):
    ok, eff, msgs = check_pair(args.theme, args.pairing, args.surface)
    for m in msgs:
        print(m)
    return 0 if ok else 1


def cmd_manifest(args):
    cat = load_catalog()
    meta = gfonts_meta()
    rows = []
    for name, p in cat["pairings"].items():
        if p.get("license") == "system":
            rows.append((name, "-", "system stacks", "-", "system", 0, "system",
                         "ok", "system"))
            continue
        for role, fam, w, source, ld in pairing_faces(p):
            path = os.path.join(CACHE, face_filename(fam, w))
            n = os.path.getsize(path) if os.path.exists(path) else 0
            lic = ("n/a (local file)" if source == "local"
                   else license_for(fam, meta))
            status = "ok" if (n or source == "local") else "NOT FETCHED"
            rows.append((name, role, fam, w, source, n, lic, status,
                         p.get("license")))
    write_manifest(rows)
    return 0


def main():
    ap = argparse.ArgumentParser(prog="dk", description="design-kit compiler")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list"); p.add_argument("what", choices=["themes", "fonts"])
    p.add_argument("--theme"); p.set_defaults(fn=cmd_list)

    p = sub.add_parser("show"); p.add_argument("theme"); p.set_defaults(fn=cmd_show)

    p = sub.add_parser("check"); p.add_argument("theme"); p.add_argument("pairing")
    p.add_argument("--surface", choices=["deck", "artifact", "frame", "pptx"])
    p.set_defaults(fn=cmd_check)

    p = sub.add_parser("fetch"); p.add_argument("pairing", nargs="?")
    p.add_argument("--all", action="store_true"); p.set_defaults(fn=cmd_fetch)

    p = sub.add_parser("compile"); p.add_argument("theme"); p.add_argument("pairing")
    p.add_argument("--surface", required=True, choices=["deck", "artifact"])
    p.add_argument("--out"); p.add_argument("--strict", action="store_true")
    p.add_argument("--scope", help="emit the theme block scoped to this selector "
                                   "instead of :root[data-theme=...] — for "
                                   "embedding several themes in one page")
    p.set_defaults(fn=cmd_compile)

    p = sub.add_parser("assert-fonts"); p.add_argument("theme"); p.add_argument("pairing")
    p.add_argument("--surface", default="deck", choices=["deck", "artifact"])
    p.set_defaults(fn=cmd_assert_fonts)

    p = sub.add_parser("manifest"); p.set_defaults(fn=cmd_manifest)

    args = ap.parse_args()
    if args.cmd == "fetch" and not args.pairing and not args.all:
        die("fetch needs a PAIRING or --all")
    sys.exit(args.fn(args) or 0)


if __name__ == "__main__":
    main()
