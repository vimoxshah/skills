---
name: house-decks
description: >
  Author, edit, present, and export house-style HTML decks — the <deck-stage>
  system (1920×1080 auto-scaled slides, keyboard nav, speaker-notes presenter
  window, print→PDF variant, reveal/pop/terminal animations, theme tokens from
  design-kit). Use when asked to "make a deck", "house deck", "presentation
  about X", or to edit/extend/export any deck in the decks folder. For native
  .pptx from scratch prefer the pptx skill; for video/slideshow motion pieces
  prefer HyperFrames.
---

# house-decks — the house deck system

**Role.** You are building or editing a presentation in the user's established house deck system — mined from their 10 existing decks. The system is already excellent; your job is fidelity to it, not invention.

**Context.** Decks live in `$DECKS_DIR` (default `~/Decks`); set the env var to point elsewhere. Canonical assets live in this skill's `template/` (deck-stage.js Jun-10 build with slide duplication, deck-anim.js, deck.css, colors_and_type.css, tweaks panel, and `deck.html` — a verified 4-slide starter: title → content → divider → close). Existing decks live in `$DECKS_DIR/<Deck Name>/`; many carry **older copies** of the system files — the template is canonical for new decks, but when *editing* an existing deck, respect its local versions (don't swap system files mid-deck unless asked). References here load on demand: [grammar](references/grammar.md) · [narrative](references/narrative.md) · [export](references/export.md) · [qa](references/qa.md) · [motion](references/motion.md) · **[taste](references/taste.md) — the owner's standing corrections (colors, pacing, no-fragments, plain language); read it before authoring or restyling ANY deck, and let it win over older guidance here.**

**Task.** Run the phase that matches the request:

## New deck

1. **Frame it** (one exchange): audience, occasion, time budget, the ask. Pick the deck type + slide budget from `references/narrative.md` (4–6 one-pager · 13–21 exec · ~19–28 technical · 36+ flagship). State type + budget; don't silently build a 50-slide deck for a 10-minute slot.
2. **Outline gate**: propose 2–3 named alternative arcs, each as a list of `data-label`s with archetype per slide (from `references/narrative.md` arcs + `references/grammar.md` archetypes), each with an angle (what it foregrounds), a cost (what it de-emphasises or drops), and the feeling curve + peak slide from `references/narrative.md`'s feeling-curve section. Get approval on one before writing slides — restructuring HTML later is the expensive path. This is arc-level only; it does not extend to theme, type, or slide styling, where "fidelity to the house system is the default; invention is the exception" (below) still stands, per `references/taste.md`.
3. **Scaffold**: `mkdir "$DECKS_DIR/<Deck Name>"`, copy `template/*` in (deck.html → `<Deck Name>.html`), set `<title>`.

   **Theme + font are two picks, from `design-kit`** (that skill owns all colour/type values — never hand-pick hex here):

   ```bash
SKILLS=${SKILLS:-$(ls -d ~/.claude/skills ~/.agents/skills ~/.cursor/skills 2>/dev/null | head -1)}
   dk=$SKILLS/design-kit/scripts/dk.py
   python3 $dk list themes                      # contexts + each theme's default pairing
   python3 $dk list fonts --theme festival      # ONLY the compatible pairings, + why others are refused
   python3 $dk fetch anton-archivo              # once per pairing
   python3 $dk compile festival anton-archivo --surface deck --strict --out theme.css
   ```

   - The default is **`house-purple`** — the house look, transcribed verbatim from this template's own `indigo` theme (light content slides, dark moment slides, purple as an accent only). Its siblings `house-aurora` / `house-boot` / `house-keynote` are the template's other three built-ins, same provenance.
   - **The six authored themes are departures, not alternatives.** `festival` · `terminal-neon` · `jewel-velvet` · `cobalt-grid` · `sunset-editorial` · `poster-bone` are legitimate for a launch, a keynote, a workshop — but they will not look like the existing deck library, so pick one *deliberately* and say you did. Most of them saturate the ground in their accent hue, which throws away the lightness-driven hierarchy the house grammar's type scale was tuned against. **Fidelity to the house system is the default; invention is the exception.**
   - Then **ask which font pairing**, offering only the compatible list. Take the default on low-stakes work and say which you took.
   - Wire it — **four edits, and the last one is the one people miss**: `<link rel="stylesheet" href="theme.css">` after the template's `<style>` · copy the woff2 files it names into `./fonts/` and drop the `fonts.googleapis.com` links (local fonts survive bad wifi) · uncomment the theme's entry in `THEME_KEY` · **set `TWEAK_DEFAULTS.theme` to that entry's display name** (e.g. `"theme": "Festival"`). The tweaks panel writes `data-theme` on mount from `TWEAK_DEFAULTS`, so it *overwrites* whatever `<html data-theme>` says — miss this and the deck silently renders in the template's default theme while every other check still passes.
   - `--strict` is not optional when you intend to report success: a silent font fallback renders a deck in none of its intended type. Run `dk.py assert-fonts` and let `visual-verify`'s `fontload` check prove it applied.
   - Each theme declares a **rationing** rule (hero hue + max emphasis hues per slide). Festival ships five hues; using all five on one slide means nothing reads as the point. Respect it while authoring, not at QA.
4. **Author slides** per `references/grammar.md` — archetype classes, fixed type scale, `--i`/`--d` animation staggers, `c-*` emphasis spans, real numbers only (verify counts via query_intelligence/live sources, never memory). Content discipline applies (no internal ticket refs, no hype adjectives). Fragment stepping and the motion layer (diagram draw-ins, comparison-split, honest count-ups) are opt-in on top of this — link `template/deck-motion.css` and `template/deck-fragments.js`/`deck-motion.js` per `references/motion.md`; they are additive and inert until a slide uses their attributes. A **3D page turn** is available as a separate opt-in (`deck-pageturn.css` + `deck-pageturn.js`, switched on with `<deck-stage data-pageturn>`) — right for a narrative or workshop deck read front-to-back, wrong for a reference deck people jump around in; see `references/motion.md` §Optional: the 3D page turn, which also records the mechanic people get backwards.
5. **Speaker notes**: fill the `speaker-notes` JSON array — one string per slide, same order, shorthand bullets. Notes carry the density; slides stay sparse.
6. **QA gate**: run `references/qa.md` in full — structural checks + Playwright screenshot smoke + read the screenshot. A deck is not done unverified.
7. **Exports**: generate the `-print.html` variant per `references/export.md`; offer PDF/PPTX/thumbnail paths.

## Edit existing deck

Read the deck's own files first (grammar may predate the template). Make the edit in its idiom; re-run the QA slide/notes-count check; **regenerate its `-print.html`** if one exists (it is derived, never separately edited). If the user asks for system-file upgrades (new deck-stage features), copy from `template/`, then full QA.

## Present / export only

Go straight to `references/export.md` (F/N/keys cheatsheet, PDF recipe, PPTX options, per-slide PNGs).

**Format.** Deliverables are files in the deck's folder — the main HTML, the synced `-print.html`, and (optionally) `_preview/` PNGs. Always finish by reporting: deck path, slide count, theme + font pairing used, QA tier run and the screenshot verdict, and the export(s) produced. Compose with: `design-kit` (theme/font/motion tokens — the source of every colour and typeface), `visual-verify` (the rendering gate), `dataviz` (charts on slides — ramps come from the theme's `charts` block), `statistician` agent (pressure-test claimed numbers), `persona-walkthrough`/`brand-guardian` agents (audience/brand review), `pptx` skill (native PowerPoint), HyperFrames (motion video from deck content). The `presentation-director` agent drives this whole loop when the surface isn't already chosen.
