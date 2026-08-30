# Slide grammar — the house vocabulary

Mined from the author's ten existing decks (2026-07-15). The system is **self-contained HTML**: `deck-stage.js` (component) + a per-deck `<style>` block following this shared vocabulary + optional `colors_and_type.css` (brand tokens). The template's style block already defines everything below — extend it, don't reinvent.

## Slide archetypes (pick per role)

| Archetype | Class | Use |
| --- | --- | --- |
| Title/opening | `slide moment` | logo chip + display H1 (122px, weight 300) + `.sub` tagline |
| Section divider | `slide moment center` | display H1 only, gradient bar accent, decorative absolute circles (opacity .2–.25); no body |
| Standard content | `slide` | `.eyebrow` kicker → H1 (`--i:1`) → `.sub` H2 (`--i:2`) → body → `.foot` |
| Before/after, framework | `slide s-pattern` | two-col `grid-template-columns:1fr 1fr; gap:30px`, `.pattern-box` with `.label` BEFORE/AFTER, mono code right |
| Terminal/demo moment | `slide moment` + `data-anim="terminal"` | `.terminal > .term-head + .term-body > .term-line` (max-width 800px) |
| Simple divider | `slide s-divider` | H1 + `.divider-idx` numbered badges |

Every `<section>` gets `data-label="Short Name"` (drives nav + notes viewer).

## Type scale (fixed — do not invent sizes)

122px display (title/divider H1, weight 300, letter-spacing -.02em) · 67px content H1 · 56px box-hero · 48-50px secondary H1 · 32px `.sub` H2 · 24px body/eyebrow · 21px `.foot` · 16-18px terminal/mono.
Max-widths: 1500px titles · 1480px visuals · 800px centered moments · 1700px wide bodies (MCP-deck style).

## Animation contract (deck-anim.js + CSS keyframes)

Animations fire only on the active slide (`[data-deck-active]`); respect `prefers-reduced-motion`.

- `.reveal` + `style="--i:N"` — staggered fade/rise, 0.085s × N (prose, lists, headings)
- `.pop` + `--i:N` — scale-in 0.9→1 (emphasis boxes, chips)
- `.eqrow > .eqbox` + `--d:0..1` — equation/comparison boxes staged over ~1s; `.eqop` for the +/= operators
- `.pulse` on `.eyebrow .dot` — infinite breathing accent
- `.kicker-line` — scaleX grow under kickers
- `data-anim="terminal"` on the section — deck-anim.js types `.term-line`s sequentially
- `.cmdgroup li.gp` + `--g:0..7` — command-trace color sweep

**Choreography rule:** reveals are paced to the presenter's speech, never front-loaded. The failure mode is a slide that dumps everything on entry and then freezes — a wall of `.reveal`/`.pop` staggers that all finish inside a second, after which the slide has nothing left to give while the presenter is still three sentences from the point. **Owner default (2026-08, see `taste.md`): solve this with SLOW automatic cascades (≈1s reveals, ≈0.16s staggers, SVG late-beats at 2–4s), NOT with `data-fragments` — key-press stepping was explicitly rejected. Use fragments only when the owner asks for them.**

### Motion layer (opt-in — deck-fragments.js, deck-motion.css, deck-motion.js)

A deck that links `deck-motion.css` and `deck-fragments.js`/`deck-motion.js` (see `references/motion.md`) gets, additively, on top of the contract above:

- `data-fragments` on the section + `data-frag="N"` on children — presenter-paced stepping. Forward/backward keys reveal or un-reveal one group at a time; only once every group is shown does the key advance the slide itself. Programmatic API: `window.deckFragments.{next,prev,state}`.
- `--mo-fast`/`--mo-base`/`--mo-slow`/`--mo-ease`/`--mo-ease-out`/`--mo-stagger` — the canonical cross-surface motion tokens (design-kit schema); use these, don't invent new durations/easings for motion-layer work.
- `data-anim="draw"` on the section — stroke-draws `<svg><path pathLength="1">` diagrams, staggered via `--d:0..N` (seconds), same idiom as `.eqbox`.
- `.s-pattern > .left` (+ its sibling), or `.pattern-box.before`/`.pattern-box.after` — the two panels of a before/after slide enter from opposite sides so the contrast animates, not just the content.
- `data-count-honest="N"` — a `[data-count]`-style stat that climbs from a floor of 1 instead of 0 (see `motion.md` for why `[data-count]` itself still animates from 0, and why the two are not merged).

## Color & emphasis

- Emphasis inside headings via semantic spans: `<span class="c-coral">`, `.c-green`, `.c-accent`, `.c2`–`.c6` — **never raw hex in content markup**.
- Vars come from the template style block (`--accent`, `--ink`, `--card`, `--border`, `--display`, `--font-mono`…).
- Dark is the default canvas; `slide dark` / navy-deep sections for contrast beats.

## Layout vocabulary (reuse before inventing)

`.eqrow/.eqbox/.eqop/.eqhero` (equations/comparisons) · `.statstrip/.stat` (number rows) · `.cmdgrid/.cmdgroup/.cmd` (command catalogs) · `.card/.chip/.chiprow` (badges) · `.two/.wide-l/.wide-r` (columns) · `.spacer` (vertical rhythm) · `.note/.ok/.warn` (status) · `.terminal` family · `.divider-*` family · `.logo-chip/.brand/.wordmark`.

Gaps: 24–30px between boxes; borders 2px `var(--border)`; radius ~20px.

## Speaker notes contract

One `<script type="application/json" id="speaker-notes">` before the tail scripts: a JSON **array of strings, one per slide, in slide order** (shorthand bullets, not prose). The notes button (N) opens a separate presenter window; count MUST equal slide count.
