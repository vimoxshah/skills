# Theme schema — roles, not values

Every theme is one YAML file in `themes/`. The compiler reads every key below;
adding a theme means filling all of them, not a subset.

## Why role names

`--dk-ground` / `--dk-ink-soft` / `--dk-rule` stay true when a theme flips mode
or gets replaced. `--grey-200` becomes a lie the moment the palette changes.
Name by the job the color does, never by how it looks.

```yaml
meta:
  name: festival              # filename must match; becomes the data-theme value
  label: Festival             # human name for pickers
  default: true               # exactly ONE theme may set this
  auto_for: [customer]        # optional: contexts that OVERRIDE a taste pick
  contexts: [internal, launch]# when this theme may be offered
  modes: [dark]               # [dark] | [light] | [light, dark]
  mood: loud / high-energy
  source: <where the palette came from>
  source_of_truth: <path>     # optional: enables `dk.py check` drift detection
  best_for: >
    prose the picker shows the user

colors:                       # role -> {mode: value}. Single-mode = one key.
  ground: {dark: "#0E0B16"}   # the page/slide canvas
  raise:  {dark: "#1C1528"}   # cards, boxes — lifted off the ground
  sunk:   {dark: "#070510"}   # wells, code surfaces — below the ground
  ink / ink-soft / ink-faint  # text: primary, secondary, tertiary
  rule / rule-soft            # borders: visible, barely-there
  accent / accent-bg          # the hero hue + its tinted background

emphasis:                     # generates .c-<name> spans AND --dk-c-<name>
  gold: "#FFBE0B"             # order matters: 1st→--accent, 2nd→--accent2,
  flame: "#FB5607"            # 3rd→--accent3 in the deck adapter
  ...

siblings:                     # optional product hues (dual-mode themes)
  access: "#009CDE"

semantic:                     # MEANING, separate from decoration
  ok / warn / alert           # never reuse the accent for these

fonts:
  default: anton-archivo
  compatible: [ ... ]                 # what may be offered
  shared_surface_alternate: archivo-tight   # required if default is COMMERCIAL
  incompatible:
    fraunces-archivo: "reason shown to the user on refusal"

rationing:
  max_emphasis_per_slide: 2
  hero_hue: gold
  rule: >
    the discipline in prose — the compiler prints this, review enforces it

charts:                       # AUTHORED, not derived (see charts.md)
  categorical / sequential / diverging: [ ... ]
  good / bad: "#..."
```

## `deck_tokens` — transcribe, never re-derive

A theme that mirrors an existing hand-tuned design carries that design's tokens
**verbatim**:

```yaml
meta:
  transcribed: true
  source_of_truth: house-decks/template/deck.html  (data-theme="indigo")
deck_tokens:                    # copied token-for-token; dk.py passes through
  --bg: "#f7f7fd"
  --shadow: "0 18px 50px rgba(40,30,90,.14)"   # purple-TINTED, not neutral black
  --moment-bg: "radial-gradient(...)…"         # a specific two-stop gradient
  ...
```

When `deck_tokens` is present the compiler emits it as-is and **skips all
derivation**; only the font stacks and motion tokens are layered on.

**Why this exists.** The derivation path computes `--shadow` as neutral black,
`--moment-bg` from a formula, and `--card` as a small lightness step off the
ground. The house themes use a purple-tinted shadow, an authored gradient, and a
*white* card on a *near-white* ground separated by a border. Derived values are
not equivalent to authored ones — re-deriving a known-good theme produced
something that shared its name and nothing else.

Regenerate the transcribed themes with `scripts/import-house-themes.py`, which
re-reads the template. That also makes it a drift check: if the template's themes
are ever retuned, re-run it and the design-kit copies follow.

## Rules that hold for every theme

- **Semantic ≠ accent.** If everything is red, nothing is.
- **Neutrals are chosen, not inherited.** Bias the greys toward the accent's hue
  — a violet-tinted grey under gold, a slate under mint. Nobody names it; they
  register that it was considered.
- **Single-mode is a real answer.** A theme built for one world (a neon console,
  a letterpress poster) declares one mode. The artifact adapter then emits a
  committed single look. **Never auto-invert to fake a second mode** — that is
  how you get unreadable text on the wrong ground.
- **Emphasis order is load-bearing** in the deck adapter: hue 1/2/3 become
  `--accent`/`--accent2`/`--accent3`, which the template's existing
  `.c-accent`/`.c-coral`/`.c-green` classes already consume. Put your hero hue
  first.

## Motion tokens live once

`themes/_motion.yaml` holds durations, easings, and the stagger step for **every**
surface. A deck reveal and an artifact reveal share them, which is what makes two
different media feel like one system. It also carries the doctrine
(never-front-load, motion-must-encode, held-read, reduced-motion) so the values
travel with their rules.
