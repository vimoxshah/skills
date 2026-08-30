---
name: design-kit
description: >
  The shared design layer behind every surface you present on — one token
  registry (11 themes × 9 font pairings, validated as a pair), a local webfont
  pipeline with a license manifest, cross-surface motion tokens, and per-theme
  chart ramps. Compiles to house-decks (drop-in data-theme block), html-artifact
  (three-layer light/dark tokens), HyperFrames frames, and pptx. Use when
  choosing or applying a theme or font pairing, when a deck/artifact/video must
  look brand-true, when adding a theme, or when a surface needs tokens instead
  of hand-picked hex. Four house themes are transcribed verbatim from the deck
  template and are the proven look — house-purple (light, purple accent) is the
  default; the seven authored themes are deliberate departures, not defaults.
---

# design-kit — one design brain for every surface

**Install note.** `scripts/check-font-coverage.py` and `scripts/import-house-themes.py` read the deck template from a sibling `house-decks/` skill directory. Install `house-decks` alongside this skill if you use those two scripts; everything else here works standalone.

**Role.** You own the *values* — color, type, motion, chart ramps — that every
presentation surface consumes. You do not own layout or narrative: `house-decks`
owns deck grammar, `html-artifact` owns published pages, `hyperframes` owns
video. This skill exists so those three stop each inventing their own palette.

**Context.** Two independent picks, validated as a pair:

- **theme** = the world (color roles, emphasis hues, semantics, rationing)
- **font pairing** = the voice (display / body / mono + tracking + transform)

Not every voice suits every world, so each theme declares which pairings it is
`compatible` with and gives a **reason** for each one it refuses. The compiler
enforces that; it is not a suggestion.

```
themes/            11 themes + _motion.yaml (shared motion tokens)
fonts/catalog.yaml 9 pairings, first-class and reusable across themes
fonts/cache/       fetched woff2 (10–24 KB per face)
fonts/LICENSES.md  generated: declared license vs live-API verified
scripts/dk.py      the compiler + gates
references/        schema · fonts · adapters · charts
```
SKILLS=${SKILLS:-$(ls -d ~/.claude/skills ~/.agents/skills ~/.cursor/skills 2>/dev/null | head -1)}

## The registry

**House themes — transcribed from the deck template, not authored here.** These
are the proven look; reach for them first.

| Theme | Mode | Default pairing | Use it for |
| --- | --- | --- | --- |
| **house-purple** ★ | light | house-plex | **The house look. The default.** Purple accent, light content slides, dark moment slides |
| house-aurora | light | house-plex | Same structure, cyan-blue accent — calmer |
| house-boot | dark | house-plex | The house dark theme: deep navy, terminal-heavy content |
| house-keynote | light | house-plex | The house warm theme: paper-cream, terracotta |

**Departures — authored here.** Legitimate, but they will *not* look like the
existing deck library. Pick one only when the occasion genuinely calls for a
different voice, and say so.

| Theme | Mode | Default pairing | Use it for |
| --- | --- | --- | --- |
| festival | dark | anton-archivo | Launches, all-hands where the room should feel it |
| terminal-neon | dark | space-ibm | Engineering, demo-heavy talks |
| jewel-velvet | dark | fraunces-archivo | Exec, vision, keynote |
| cobalt-grid | light | archivo-tight | Architecture, specs, print/PDF-first |
| sunset-editorial | dark | newsreader-archivo | Retros, case studies, incidents |
| poster-bone | light | archivo-black-mono | Workshops, one-pagers, strong opinions |
| spectrum-light | light | outfit-inter | Launch-family decks/collateral: color-is-meaning lanes, petrol accent, SINGLE-WORLD LIGHT (dividers use a cream tint + spectrum-band device, never a dark ground — the yaml documents the accepted contrast finding). No violet/magenta by owner decision. |

★ default theme for internal/platform work.

### Fidelity beats variety — read this before picking

The house deck system is **light content slides with dark moment slides**, purple
(or blue/warm) used *only* as an accent, and hierarchy carried by **lightness**,
not hue. Three of the four built-in themes are light.

A theme that saturates the whole slide in the accent hue — dark purple ground,
purple cards, purple headings, purple body — collapses that hierarchy and reads
worse than the theme it replaced, even when every contrast check passes. That is
exactly what happened when `house-purple` was first authored here as a dark theme
while claiming "continuity with the existing library": same name, opposite design.

So: **the default is the house look, and a departure is a deliberate choice you
name out loud.** If someone says the output got worse after a theme change, check
whether a house theme was swapped for a departure before looking anywhere else.

Pairings: `anton-archivo` (poster) · `archivo-black-mono` (manifesto) · `outfit-inter` (launch/geometric) ·
`archivo-tight` (neutral/technical) · `space-ibm` (console) ·
`fraunces-archivo` (editorial/premium) · `newsreader-archivo` (narrative) ·
`system-stack` (zero bytes). A pairing whose `source: local` face is not
open-source is never inlined into a shared surface — `--surface artifact`
substitutes `shared_surface_alternate`.

## Task — run the flow that matches the request

### Applying a theme (the common path)

1. **Pick the theme by context, not by taste.** The default is `house-purple`;
   otherwise `festival` unless the occasion argues for another (`dk.py list
   themes` shows each theme's contexts).
2. **Offer only compatible pairings.** `dk.py list fonts --theme <name>` prints
   the allowed set with the default marked, plus the refusals and why. Ask the
   user which voice; don't silently take the default on work that matters.
3. **Compile.** Always `--strict` when you intend to report success:
   ```bash
   dk=$SKILLS/design-kit/scripts/dk.py
   python3 $dk fetch anton-archivo                     # once per pairing
   python3 $dk compile festival anton-archivo --surface deck     --strict --out theme.css
   python3 $dk compile festival anton-archivo --surface artifact --strict --out theme.css
   ```
4. **Wire it in** — see `references/adapters.md` for the exact per-surface step
   (a deck needs `data-theme="<name>"` + the woff2 files copied next to it).
5. **Verify the fonts actually loaded.** Font fallback is *silent* — a page can
   look plausible while rendering none of its intended type:
   ```bash
   python3 $dk assert-fonts festival anton-archivo   # emits the __FONTS list
   ```
   Paste that into the page you hand to `visual-verify`, whose `fontload` check
   turns it into a pass/fail. **A visual done-claim without this check is not
   evidence.**

### Adding a theme

Copy the closest existing YAML, keep every key (the compiler reads them all),
then: declare `modes` honestly (a single-world design is `[dark]` or `[light]` —
never fake a second mode by inverting), write a **reason** for every
incompatible pairing, author the `charts` ramps rather than deriving them from
UI tokens, and set `rationing` — how many emphasis hues one slide may carry.
Then compile it and *look at it*.

## The gates (enforced in code, not prose)

Compile-time, in `dk.py`:

| Gate | Behavior |
| --- | --- |
| **Compatibility** | An incompatible theme×pairing is **refused** with the authored reason and the compatible list. Exit 1. |
| **License** | A pairing whose `source: local` face is not open-source is **never inlined** into a shared surface — `--surface artifact` substitutes the theme's `shared_surface_alternate`. Local decks reference the files in place, which is not redistribution. |
| **Fail-closed fonts** | Missing bytes emit the fallback stack **plus a visible warning** in the CSS and on stderr — never a silent substitution. `--strict` exits nonzero so it cannot be reported as success. |
| **Weight normalisation** | A display face that cannot supply the weights the deck requests gets its display selectors pinned to a weight it actually has, so the browser never renders a synthesised faux-bold. |

Authoring-time, run these after touching any theme or pairing:

```bash
python3 scripts/check-ramps.py           # chart legibility + perceptual distinctness
python3 scripts/check-deck-structure.py  # deck punctuation, card lift, semantic emphasis
python3 scripts/check-font-coverage.py   # requested weights vs declared vs fetched
```

All three exit with their failure count. `check-deck-structure` and
`check-font-coverage` are **blocking for authored themes/pairings and advisory
for transcribed ones** — where an authored design is the source of truth, a
finding is information for a human, not a value for the tool to overwrite.

**Why these exist.** The compile-time gates only measure individual elements —
contrast ratios, font loading, ramp validity. A theme once passed every one of
them and still produced a materially worse deck, because nothing measured whether
the deck still had *structure* (dividers that read as sections, boxes that read
as boxes, `.c-green` that reads as positive) or whether the type could render the
weights the CSS asks for. Element-level checks do not add up to a working design.

## Rationing — why themes carry discipline

Every theme sets `max_emphasis_per_slide` and a `hero_hue`. Festival ships five
saturated hues; using all five on one slide means nothing reads as the point.
The palette is a **theme-level** set, never a **slide-level** set. This is a
review-time rule the compiler documents in its output but cannot enforce — when
reviewing a deck, count the hues per slide.

**Format.** Deliverables are a compiled `theme.css` plus the fonts beside it,
and a report stating: theme, pairing (and whether it was substituted), surface,
the fontload assertion result, and any fallback warnings. Compose with:
`house-decks` (decks) · `html-artifact` (published pages) · `hyperframes` (video)
· `dataviz` (charts — ramps come from the theme's `charts` block) ·
`visual-verify` (the gate) · `brand-guardian` agent (customer-facing review).
