# Presenting & exporting

## Presenting (built into deck-stage.js)

- Open the deck HTML in a browser. **F** = fullscreen · **N** = speaker-notes presenter window (separate window — safe to screen-share the main one) · ←/→, Space, PgUp/PgDn, Home/End, number keys · **R** = reset to slide 0.
- Thumbnail rail + slide counter overlay fade on idle.
- The tweaks panel (`tweaks-panel.jsx`) loads React/Babel from unpkg CDN — **live-tweak features need network**; presenting itself is fully offline (fonts for the house theme are Google-Fonts-linked though — for a guaranteed-offline venue, pre-open once or self-host the woffs; decks with local fonts/ + `colors_and_type.css` are offline-safe).

## PDF export (reliable path)

1. Create the `-print.html` variant: copy the main HTML, then **delete two widget blocks** — the fullscreen toggle (`<button id="fs-toggle">` + its `setupFullscreen` script) and the speaker-notes launcher (`<button id="sn-toggle">` + `<aside id="sn-panel">` + its `setupSpeakerNotes` script). Everything else stays identical (~35 lines removed; verified against an existing deck's `-print.html`).
2. deck-stage.js `@media print` lays each slide out as its own page at design size (1920×1080).
3. Open `-print.html` → browser Print → Save as PDF, landscape, default margins off, background graphics ON.

Keep `-print.html` in sync: regenerate it after any slide edit (it's a derived artifact, never hand-edited separately).

## PPTX export

- deck-stage.js implements the exporter **protocol** only: setting the `noscale` attribute on `<deck-stage>` renders slides 1:1 (no transform) so a DOM-capture exporter sees true geometry. The exporter tool itself is **external and not present on this machine**.
SKILLS=${SKILLS:-$(ls -d ~/.claude/skills ~/.agents/skills ~/.cursor/skills 2>/dev/null | head -1)}
- Practical paths, in order: (1) PDF via print variant (most faithful); (2) the `pptx` skill (`$SKILLS/pptx`) to *rebuild* the deck as native PowerPoint when a customer needs editable .pptx — treat it as a re-authoring, not a conversion (run its Python via `uv run --with python-pptx --with defusedxml --with lxml`); (3) per-slide PNGs (below) placed full-bleed into a .pptx via python-pptx — pixel-faithful but non-editable.

## Per-slide PNGs / thumbnails

```bash
npx playwright screenshot --viewport-size=1920,1080 --wait-for-timeout=2500 \
  "file:///path/to/Deck.html#N" slide-N.png   # if hash-nav is supported by the deck-stage version
```
Check hash-nav support in the deck's deck-stage.js first; otherwise use a small Playwright script that constructs the page and calls the component's `go(N)` before capturing. `_preview/` PNGs per deck folder are optional but useful (precedent: an existing deck).
