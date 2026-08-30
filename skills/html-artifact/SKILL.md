---
name: html-artifact
description: Design system and build patterns for published HTML Artifacts — decks with
  per-slide deep-dive tabs, technical explainers, reports, dashboards and landing
  pages that ship as a single self-contained file to a shareable claude.ai URL.
  Covers the CSP sandbox (no CDN fonts/scripts), three-layer light+dark theming
  that survives the viewer's toggle, deck shell mechanics (keyboard nav, hash
  deep-links, progressive disclosure), hand-authored SVG heroes and architecture
  diagrams, per-slide animation re-trigger, speaker notes and full-screen
  presenting, tab / sidebar / split / SPA-routed shells, reader-facing theme
  switching, inlining GSAP or Three.js under CSP, images and text effects, and a
  pre-publish validation script. Use when asked for an HTML artifact, a shareable
  deck or explainer, "make this presentable", "a page I can share", or when
  publishing via the Artifact tool. For local 1920x1080 house decks use
  house-decks instead; for native .pptx use pptx; for rendered video use
  HyperFrames.
---

# html-artifact — pages that survive being shared

An Artifact is not a local HTML file. It is published to a URL, rendered inside
a strict sandbox, and viewed on someone else's screen in someone else's theme.
Three constraints follow, and almost every broken artifact violates one:

1. **Nothing loads from the network.** No CDN fonts, no external CSS/JS, no
   remote images, no `fetch`. Inline everything or use system stacks.
2. **You do not control the theme.** The viewer's OS preference *and* their
   in-page toggle both apply. Design both, or one of them looks broken.
3. **You do not control the viewport.** Projector, laptop, phone. Fixed pixel
   stages do not survive; diagrams shrink their labels into illegibility.

Load `artifact-design` for visual direction (palette, type, treatment level).
This skill is the *build* layer: the mechanics that make it work once designed.

## Workflow

1. **Read the request.** Deck / report / dashboard / landing page? Who reads it,
   and do they need one depth or two? Two audiences → deep-dive tabs (below).
2. **Pick tokens before markup.** 4–6 named colors, 2–3 type roles, one layout
   idea. Write them down. Derive every later decision from them.
   - Skip below when the user named a direction, brand pins the palette
     (`design-kit`, required below), or `artifact-design` set the treatment
     level. Otherwise, when genuinely open: name 2–3 directions,
     each with a one-phrase **angle** (what it changes) and **cost** (what
     it gives up) — two directions differing only in accent color or copy
     are one direction. Build the cheapest artifact that discriminates
     between them — the existing template with a different token block, not
     three finished pages — let the user pick, never self-select. Prefer one
     page with a theme switch (`references/theming.md`) over publishing N
     candidates.
3. **Build against `references/`** — load only what the piece needs.
4. **Validate before publishing** — `references/qa.md` has a script that catches
   the failures that survive visual inspection.
5. **Publish** with the Artifact tool. Re-publishing the same file path keeps
   the same URL.

## References

| Load when | File |
| --- | --- |
| Always — tokens, type, the three-layer theme block | `references/design-system.md` |
| Giving the reader a theme switch; print/PDF | `references/theming.md` |
| Building a slide deck or any paged piece | `references/deck-shell.md` |
| Speaker notes, full screen, presenting live | `references/presenting.md` |
| Tabs, sidebar, split view, SPA routing | `references/layouts.md` |
| Any diagram, hero, architecture or flow | `references/svg-diagrams.md` |
| Adding motion | `references/motion.md` |
| GSAP, Three.js, 3D, any third-party library | `references/libraries.md` |
| Images, text effects, code blocks, data display | `references/rich-media.md` |
| Filters, counters, live-feeling data, state | `references/dynamism.md` |
| Writing the words — stats, titles, sourcing | `references/content.md` |
| Before every publish, and after | `references/qa.md` |

### Sibling skills — use, don't duplicate

This skill owns the **Artifact sandbox and build mechanics**. Motion and visual
judgement live elsewhere and are better there:

- `artifact-design` — treatment level, palette and type direction. Load first.
- `animate` / `animation-vocabulary` — choosing curve, duration, and what an
  effect is called.
- `apple-design` — spring physics, material and depth.
- `emil-design-eng` — the small polish details that separate good from shipped.
- `design-kit` — the token/theme/font registry. Prefer it over inventing a
  palette: 8 themes × 8 font pairings (validated as a pair), and
  `dk.py compile <theme> <pairing> --surface artifact` emits the whole
  three-layer token block plus data-URI `@font-face` rules ready to paste.
  Required when the page must match a house theme. `theme-factory` remains as a
  fallback for a quick mood when design-kit has nothing suitable.
- `dataviz` — before building any chart.

`template/artifact.html` is a working deck shell — tokens, nav, deep-dive tabs,
one SVG, validation-clean. Copy and replace the content.

## Deep-dive tabs — one deck, two audiences

The pattern that makes a deck work for an exec *and* an engineer: each slide
carries its headline argument, with optional tabbed panels underneath holding
the evidence. Collapsed by default, so the skim path is unbroken; expanded on
demand, so nobody needs a second document.

Use it when the same page must serve "approve this" and "how exactly". Do not
use it to hide content you could not edit down — a dive panel is for *depth*
(payloads, SQL, file:line citations, derivations), never for overflow prose.

Mechanics in `references/deck-shell.md`.

## Non-negotiables

- **Theme both ways.** The three-layer token pattern in `design-system.md` is
  the only reliable form. A `@media` query alone loses to the viewer's toggle.
- **Diagrams scroll, never shrink.** `.scroll{overflow-x:auto}` + a `min-width`
  on the SVG. A diagram squeezed to phone width has 6px labels.
- **Slides own their scroll.** `height:100dvh; overflow-y:auto` per slide — not
  `min-height`, which makes the body scroll and breaks paging.
- **Respect `prefers-reduced-motion`** in every animated rule, including SVG
  draw-ins and progress transitions.
- **Every figure gets `role="img"`, an `aria-label` carrying the claim, and a
  `<figcaption>`.** The label is the diagram's one-sentence meaning, not "diagram".
- **Numbers must be sourced.** If the page asserts a figure, the figure came
  from a command you ran. Unverified numbers in a shared artifact outlive the
  conversation that produced them.
- **A figure that makes the work sound easy has been measured too narrowly.**
  Re-derive it from the other direction before publishing (`references/content.md`).
- **Rank your sources before concluding.** Running system > machine-readable
  contract > reference docs > slideware. "The spec is stale" is a strong claim;
  "the slide is wrong" is usually the right one.
- **Never narrate your own process in the deliverable.** Findings belong on the
  page; how you found them belongs one layer down.
- **Verify the published page, not the publish call.** The tool returns the same
  URL whether or not anything changed — fetch it back and check
  (`references/qa.md`).
- **No CDN, ever — it fails silently.** A `<script src="https://…">` is blocked,
  the library is undefined, and nothing appears in the console. Libraries must be
  inlined from a local copy (`references/libraries.md`). GSAP core is 72 KB and
  entirely practical; Three.js is 1.2 MB and needs justifying.
- **Hash routing, not History API.** Artifacts are served under a path you do not
  control, so `pushState('/settings')` produces a URL that 404s on reload.
- **`window.open` and `requestFullscreen` may be blocked by the iframe sandbox.**
  Always ship a fallback (`references/presenting.md`) — a blocked permission
  should degrade, never fail.

## Anti-slop

Avoid the current AI-design cluster unless the user asks for it: warm cream +
serif + terracotta; near-black with one acid-green pop; purple→blue gradient
hero; Inter or Space Grotesk as the default face; emoji as section markers;
everything centered; `rounded-lg` on every card; a numbered `01 / 02 / 03` rail
where the content is not actually a sequence.

Ground the palette in the subject instead. Colors that *encode* something —
old vs new, safe vs blocked, ours vs theirs — read as designed; colors chosen
for mood read as decoration.
