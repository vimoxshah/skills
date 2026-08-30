#!/usr/bin/env python3
"""Generate the design-kit showcase — every theme rendered with its real font
pairing, as mini deck slides, in one self-contained page.

This is the browsable catalog the theme picker shows the user. It is generated
from the SAME compiler the real surfaces use, so what you see is what a deck
will actually look like — not a hand-drawn approximation that can drift.

  python3 showcase.py [--out FILE] [--surface deck|artifact]

`--surface artifact` inlines the fonts as data URIs (self-contained, publishable);
`--surface deck` references fonts/ next to the file (smaller, local).
"""
import argparse
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dk  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# One demo slide per theme, written to exercise that theme's OWN voice and to
# respect its own rationing rule (hero hue + at most one support hue).
DEMOS = {
    "festival": dict(sub="Forty-eight hours from idea to production, across thirty-one services — every one of them gated.", 
        kicker="THE NUMBERS", eyebrow="V3.0 · LAUNCH",
        h1=("Ship <em>faster</em>.<br>Break <b>nothing</b>."), hero="gold", support="magenta",
        stats=[("48h", "idea → prod"), ("31", "services"), ("100%", "gated")],
        term="$ ship --verify", term2="✓ 3 gates passed · PR #482 ready"),
    "terminal-neon": dict(sub="Scope, implement, verify. The agent proposes; the gates decide what actually ships.", 
        kicker="AUTONOMY · 02", eyebrow="PLATFORM REVIEW",
        h1="Every merge crosses <em>three gates</em>", hero="mint", support="amber",
        stats=[("142", "features"), ("9.7×", "velocity"), ("0", "rollbacks")],
        term="$ scope --feature 041", term2="✓ 4 services · 0 breaking"),
    "jewel-velvet": dict(sub="Every feature teaches the next one. Decisions accumulate into a constitution the platform enforces.", 
        kicker="COMPOUNDING · 04", eyebrow="FY27 PLATFORM VISION",
        h1="A platform that <em>compounds</em>", hero="gold", support="orchid",
        stats=[("312", "decisions"), ("57", "rules learned"), ("12", "skills evolved")],
        term="› every feature teaches the next one", term2=""),
    "cobalt-grid": dict(sub="Three services in scope, fourteen endpoints touched, zero breaking changes to the public contract.", 
        kicker="BLAST RADIUS", eyebrow="SPEC-041 · REV C",
        h1="Three services in scope, <em>one contract</em>", hero="cobalt", support="coral",
        stats=[("3", "services"), ("14", "endpoints"), ("0", "breaking")],
        term="$ impact --endpoint /v2/items", term2="✓ verified"),
    "sunset-editorial": dict(sub="The alert fired at 02:14. What we did in the next nineteen minutes mattered more than the roadmap.", 
        kicker="TIMELINE · 03", eyebrow="Q2 INCIDENT RETROSPECTIVE",
        h1="Nineteen minutes, <em>three decisions</em>", hero="amber", support="red",
        stats=[("19m", "to recover"), ("3", "decisions"), ("1", "root cause")],
        term="› the outage taught us more than the roadmap did", term2=""),
    "poster-bone": dict(sub="Seventy-three percent of rework traces back to a spec that never said what it meant.", 
        kicker="CLAIM 02", eyebrow="WORKSHOP",
        h1="Specs are <em>not</em> documentation.<br>They are decisions.", hero="red",
        support=None,
        stats=[("73%", "rework traced"), ("41", "spec gaps"), ("1", "fix: clarify")],
        term="› strong opinions, held loosely", term2=""),
    "house-purple": dict(sub="Ten decks already speak this language. Continuity is a feature, not a compromise.", 
        kicker="THE HOUSE LOOK", eyebrow="INTERNAL / PLATFORM",
        h1="The original house theme — <em>still here</em>", hero="accent", support="green",
        stats=[("10", "existing decks"), ("0", "migrated"), ("1", "attribute")],
        term="$ still the safe pick for continuity", term2=""),
}

PAGE_CSS = """
*{box-sizing:border-box}
body{margin:0;background:#0d1014;color:#e8eef4;
  font:15px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:44px 22px 90px}
h1.pt{font:300 clamp(28px,4.4vw,42px)/1.12 ui-serif,Georgia,serif;margin:0 0 10px;
  letter-spacing:-.02em}
.lede{color:#93a3b4;max-width:70ch;margin:0 0 6px}
.note{color:#6d7d8e;font-size:13.5px;max-width:76ch}
.eyebrow{font:600 11.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.15em;
  text-transform:uppercase;color:#5fa8d3;margin:0 0 14px}
.tname{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:46px 0 4px}
.tname h2{font:600 19px/1.3 ui-sans-serif,system-ui,sans-serif;margin:0}
.tag{font:600 10.5px/1 ui-monospace,monospace;letter-spacing:.09em;padding:4px 8px;
  border-radius:999px;background:#1b2430;color:#8fa6bb}
.tag.def{background:#1d4d38;color:#8ff0bd}
.tag.auto{background:#3a2a12;color:#f0c98f}
.meta{color:#7c8b9c;font-size:13px;margin:0 0 14px}
.meta code{font:12.5px ui-monospace,monospace;background:#161d26;padding:1px 5px;
  border-radius:4px;color:#a9bccd}
/* the mini slide — 16:9, mirrors real deck anatomy */
.slidewrap{border:1px solid #222c38;border-radius:14px;overflow:hidden}
.mini{aspect-ratio:16/9;padding:4.4% 5%;display:flex;flex-direction:column;
  background:var(--bg);color:var(--ink);font-family:var(--font);position:relative}
.mini .kick{font:700 10px/1 var(--mono);letter-spacing:.17em;text-transform:uppercase;
  color:var(--accent);display:flex;align-items:center;gap:7px;margin-bottom:2.4%}
.mini .kick i{width:6px;height:6px;border-radius:50%;background:var(--accent);
  display:inline-block}
.mini .eb{font:700 9px/1 var(--mono);letter-spacing:.14em;color:var(--ink-mute);
  margin-bottom:1.6%}
.mini h3{font-family:var(--display);font-weight:400;letter-spacing:var(--dk-track-display,-.02em);
  font-size:clamp(20px,3.05vw,40px);line-height:1.07;margin:0 0 2.2%;
  text-transform:var(--dk-transform-display,none)}
.mini h3 em{font-style:normal;color:var(--accent)}
.mini h3 b{font-weight:inherit;color:var(--accent2)}
.mini .sub{color:var(--ink-dim);font-size:clamp(10px,1.15vw,14px);max-width:64%}
.mini .stats{display:flex;gap:3.4%;margin-top:auto}
.mini .st{flex:1;background:var(--card);border:1px solid var(--border);
  border-radius:9px;padding:2.4% 2.8%}
.mini .st b{display:block;font-family:var(--display);font-weight:400;
  font-size:clamp(15px,2.1vw,26px);color:var(--accent);letter-spacing:-.02em;line-height:1}
.mini .st i{font:600 8.5px/1.5 var(--mono);letter-spacing:.1em;text-transform:uppercase;
  font-style:normal;color:var(--ink-mute)}
.mini .term{margin-top:2.6%;background:var(--term-bg);border:1px solid var(--border);
  border-radius:8px;padding:1.9% 2.4%;font:400 clamp(9px,1.02vw,12px)/1.7 var(--mono);
  color:var(--term-ink)}
.mini .term s{text-decoration:none;color:var(--term-accent)}
.mini .term u{text-decoration:none;color:var(--term-dim);display:block}
.specs{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;margin-top:12px;
  font:12px/1.7 ui-monospace,monospace;color:#8697a8}
.sw{display:flex;gap:5px}
.sw span{width:20px;height:20px;border-radius:5px;border:1px solid rgba(255,255,255,.14)}
.ration{color:#6d7d8e;font-size:12.5px;margin-top:8px;max-width:80ch}
.ration b{color:#9fb0c1;font-weight:600}
@media(max-width:640px){.mini{padding:5.5% 6%}.mini .stats{gap:2.5%}}
"""


def build(surface, out):
    themes = [t for t in dk.theme_names()]
    order = ["festival", "terminal-neon", "jewel-velvet", "cobalt-grid",
             "sunset-editorial", "poster-bone", "house-purple"]
    themes = [t for t in order if t in themes] + [t for t in themes if t not in order]

    css_blocks, body, warnings = [], [], []
    for name in themes:
        th = dk.load_theme(name)
        pairing = th["fonts"]["default"]
        scope = f".t-{name}"
        cmd = [sys.executable, os.path.join(HERE, "dk.py"), "compile", name, pairing,
               "--surface", surface, "--scope", scope]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            warnings.append(f"{name}: compile failed -> {r.stderr.strip()[:120]}")
            continue
        if "FONT FALLBACK" in r.stdout:
            warnings.append(f"{name}: font fallback in effect (run dk.py fetch {pairing})")
        css_blocks.append(r.stdout)

        d = DEMOS.get(name, {})
        emph = th.get("emphasis") or {}
        hero = d.get("hero") or (list(emph) or ["accent"])[0]
        sup = d.get("support")
        # honour the theme's own rationing: hero + at most one support hue
        h3 = d.get("h1", th["meta"]["label"])
        stats = "".join(
            f'<div class="st"><b>{v}</b><i>{k}</i></div>' for v, k in d.get("stats", []))
        term = d.get("term", "")
        term2 = d.get("term2", "")
        termhtml = (f'<div class="term"><s>{term}</s>'
                    + (f"<u>{term2}</u>" if term2 else "") + "</div>") if term else ""
        m = th["meta"]
        tags = []
        if m.get("default"):
            tags.append('<span class="tag def">DEFAULT</span>')
        if m.get("auto_for"):
            tags.append('<span class="tag auto">AUTO: CUSTOMER-FACING</span>')
        tags.append(f'<span class="tag">{"/".join(m["modes"])}</span>')
        pal = "".join(f'<span style="background:{v}"></span>'
                      for v in list((th.get("emphasis") or {}).values())[:6])
        r_ = th.get("rationing") or {}
        cat = dk.load_catalog()["pairings"][pairing]
        alts = [p for p in th["fonts"].get("compatible", []) if p != pairing]

        body.append(f"""
<div class="tname"><h2>{m['label']}</h2>{''.join(tags)}</div>
<p class="meta">{m.get('best_for','').strip()}<br>
  font pairing <code>{pairing}</code> — {cat['mood']}
  {'· also allows <code>' + '</code> <code>'.join(alts) + '</code>' if alts else ''}</p>
<div class="slidewrap"><div class="mini t-{name}">
  <div class="eb">{d.get('eyebrow','')}</div>
  <div class="kick"><i></i>{d.get('kicker','')}</div>
  <h3>{h3}</h3>
  <div class="sub">{d.get("sub","")}</div>
  <div class="stats">{stats}</div>
  {termhtml}
</div></div>
<div class="specs"><div class="sw">{pal}</div>
  <span>display: {(cat.get('display') or {}).get('family','system')}</span>
  <span>body: {(cat.get('body') or {}).get('family','system')}</span></div>
<p class="ration"><b>Rationing:</b> max {r_.get('max_emphasis_per_slide','?')} emphasis
  hue(s) per slide · hero <b>{r_.get('hero_hue','?')}</b>. {(r_.get('rule') or '').strip()}</p>
""")

    warnblock = ""
    if warnings:
        warnblock = ('<p class="note" style="color:#f0a3a3">Build warnings: '
                     + " · ".join(warnings) + "</p>")

    html = f"""<title>design-kit — theme &amp; font showcase</title>
<style>{PAGE_CSS}</style>
<style>{''.join(css_blocks)}</style>
<div class="wrap">
<p class="eyebrow">design-kit · generated showcase</p>
<h1 class="pt">Eight themes, eight voices</h1>
<p class="lede">Every slide below is rendered by the <em>same compiler</em> the real
decks and artifacts use — theme tokens and the real font pairing, not a mockup.
What you see is what a deck will look like.</p>
<p class="note">Theme and font pairing are two independent picks, validated as a pair:
each theme lists the pairings it allows and refuses the rest with a reason.
<b>Festival</b> is the default for internal work; pick another theme by
context for anything customer-facing.</p>
{warnblock}
{''.join(body)}
<p class="note" style="margin-top:44px;padding-top:18px;border-top:1px solid #222c38">
Regenerate with <code>python3 scripts/showcase.py --surface {surface}</code>.
Each mini slide respects its theme's own rationing rule — hero hue plus at most
one support hue — which is why none of them use their full palette at once.</p>
</div>
"""
    with open(out, "w") as fh:
        fh.write(html)
    print(f"wrote {out} ({len(html)} bytes, {len(css_blocks)} themes)")
    for w in warnings:
        print("WARNING: " + w, file=sys.stderr)
    return 1 if warnings else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "showcase.html"))
    ap.add_argument("--surface", default="artifact", choices=["deck", "artifact"])
    a = ap.parse_args()
    sys.exit(build(a.surface, a.out))
