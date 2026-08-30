# House taste — the deck owner's standing corrections

Mined from the AgentD deck rebuild (2026-08-16, three correction rounds). These are
**owner decisions, not suggestions** — apply them to every new deck and every edit
unless the owner explicitly overrides for a specific deck. When one of these
conflicts with an older reference in this skill, this file wins.

## Color & theme

- **No violet, no magenta, no pink-leaning purples.** The owner reads them as
  "AI slop." No mixed-gradient display text either (`.grad`-style two-hue
  headlines) — emphasis is a single solid hue via `c-*` spans.
- **Single-world light.** No dark slides mixed into a light deck. Divider/moment
  slides differentiate with a cream tint + a structural device (full-width
  spectrum band, oversized display type) — never a dark ground. The only dark
  surface allowed is a terminal panel.
- For launch-family work the registry theme is **`spectrum-light`** (design-kit)
  with the **`outfit-inter`** pairing — petrol accent, slate reserved hue, lanes
  amber/coral/teal/azure/lime/slate. Its theme yaml documents the accepted
  moment-contrast gate finding; the compensating divider device is mandatory.

## Motion

- **Everything reveals automatically.** No key-press fragment stepping — content
  cascades in on slide entry, paced so people can feel it: reveals ≈1s with
  ≈0.16s stagger, pops ≈0.95s, SVG "late" beats at ~2.2s/3.6s. Fragments
  (`data-fragments`) only when the owner explicitly asks.
- **Slide transition = slow page flip** (~1.15s, spine-anchored rotateY,
  direction-aware). No fast tilts.
- Decorative loops (SMIL pulses, radar sweeps) should feel calm — 3–5s cycles.

## Content & typography

- **Decks cover WHAT and WHY — never HOW.** Methodology slides ("so we tested
  it", "what we broke"), internal-mechanism slides (gates, connector failure
  shapes), and CLI how-to slides get cut; the owner carries the "how" in live
  demos on their machine. Keep proof numbers (test counts) on the title slide
  and in speaker notes, not as slides. A slide the room "can't understand"
  (owner's words) gets deleted, not explained harder.
- **Product facts come from the owner's latest reference table, not memory.**
  When the owner pastes a monitor/feature table, it is the ground truth for
  every slide that names the thing — purposes, termini/routing counts, and
  caveats (e.g. a monitor that only watches its own PRs, not the whole repo).
  Sweep the whole deck for stale copies of a corrected fact: the same number
  usually lives on 2–3 slides (hero panel, sorter, doors) plus the notes.
- **Plain language over jargon.** "Rule-based" not "deterministic"; "keeping
  score" not "attesting"; "data source" not "dependency" in diagrams; assume
  non-engineers in the room. Real command/monitor names stay verbatim — the
  prose around them gets simple.
- **Display type ceilings:** ~72–78px for multi-word headlines on content-dense
  slides (the 96–122px scale is only for 1–3 word titles). Stats align on a
  grid (2×2), never a ragged wrap.
- **Heroes must explain, not decorate.** An abstract 3D scene ("solar system")
  was rejected; the accepted pattern is a story SVG of the actual product flow
  (inputs → watcher → draft PR → you decide). Diagrams should carry a **named
  layer** — real monitor/feature names visible, not just category counts.
- Title slide: logo ≥64px, the deck owner's byline in the eyebrow; closing
  slide carries "ideated & built by <owner>". Ask once, then reuse it.
- No "workshop" wording on slides or chrome.

## Interactive chrome

- The console/HUD pattern (chapter spectrum rail, tick counter, O-key overview
  wall) is approved and should *feel alive* — tick pop + LED blip per slide
  change. Rail segments must be saturated enough to read on the light chrome
  (≈45% fill inactive, 80%+ done, outlined).
