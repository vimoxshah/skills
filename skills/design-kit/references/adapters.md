# Adapters — one registry, four surfaces

An adapter is a **mapping only**. The moment one grows logic of its own it has
forked the surface skill it serves. Two are executable today; two are written
mapping specs because their toolchain is not installed here — that is stated
plainly rather than shipped as code nothing has run.

| Adapter | Status | Emits |
| --- | --- | --- |
| `to-deck` (`--surface deck`) | **executable, verified** | drop-in `:root[data-theme="…"]` block + local woff2 `@font-face` |
| `to-artifact` (`--surface artifact`) | **executable, verified** | three-layer light/dark tokens + data-URI `@font-face` |
| `to-frame` | **spec only** (needs a HyperFrames project) | `frame.md` palette/type roles |
| `to-pptx` | **spec only** (`python-pptx` not installed) | theme XML colors + font map |

---

## to-deck (verified)

Emits a block using the **exact** token names
`house-decks/template/deck.html` consumes — checked against its own
`aurora`/`indigo`/`boot`/`keynote` theme blocks:

```
--bg --bg-soft --bg-tint --card
--ink --ink-dim --ink-mute
--border --border-soft
--accent --accent-deep --accent-soft --accent-line
--accent2 --accent2-soft --accent2-line
--accent3 --accent3-soft --accent3-line
--shadow --shadow-sm
--moment-bg --moment-ink --moment-dim --moment-mute --moment-accent
--moment-card --moment-border
--term-bg --term-head --term-ink --term-dim
--font --display --mono
```

Derivations: `-soft` = accent at ~12–13% alpha · `-line` = ~34–40% ·
`-deep` = accent × 0.82 · `--moment-bg` = two radial accent washes over a
deepened ground (a light theme inverts to the ink instead) · `--term-*` from the
sunk/raise pair.

**Wiring, four steps — step 4 is the one that bites:**

```bash
SKILLS=${SKILLS:-$(ls -d ~/.claude/skills ~/.agents/skills ~/.cursor/skills 2>/dev/null | head -1)}
python3 dk.py compile festival anton-archivo --surface deck --strict --out theme.css
cp $SKILLS/design-kit/fonts/cache/{anton-400,archivo-400,archivo-600,ibm-plex-mono-400}.woff2 fonts/
# in the deck HTML:
#   1. <link rel="stylesheet" href="theme.css">   <!-- AFTER the template style block -->
#   2. drop the fonts.googleapis.com <link> tags  <!-- local woff2 survives bad wifi -->
#   3. THEME_KEY: add   "Festival": "festival"
#   4. TWEAK_DEFAULTS:  "theme": "Festival"      <!-- REQUIRED -->
```

**Why step 4 is not optional.** The tweaks panel runs
`documentElement.setAttribute('data-theme', THEME_KEY[t.theme] || 'signal')` on
mount, so it **overwrites** whatever `<html data-theme="…">` says. Setting the
attribute alone leaves the deck in the template's default theme.

This failure is invisible to every other gate — measured on a real scaffold:
`fontload` reported all five faces `true` (the faces *were* declared and loaded),
overflow was 0, contrast was clean, and the deck still rendered indigo with
`--bg:#f7f7fd`. **Only looking at the render caught it.** The two-line check:

```js
document.documentElement.getAttribute('data-theme')                 // -> "festival"
getComputedStyle(document.documentElement).getPropertyValue('--bg') // -> "#0E0B16"
```

Assert both before calling a themed deck done.

**Emphasis:** the template's `.c-accent`/`.c-coral`/`.c-green` keep working
(they read `--accent`/`--accent2`/`--accent3`). The adapter *adds* named classes
— `.c-gold`, `.c-mint`, `.c-cobalt` — so markup can say what it means.

## to-artifact (verified)

Emits html-artifact's documented names — `--ground --raise --sunk --ink
--ink-soft --ink-faint --rule --rule-soft --accent --accent-bg --warn --alert
--sans --mono --serif` — plus `body{background:var(--ground)}` because a
transparent body borrows the host's ground.

- **Dual-mode theme** → the full three-layer block: complete
  light palette on bare `:root`; dark redefined under
  `@media (prefers-color-scheme:dark)` guarded as `:root:not([data-theme="light"])`;
  then `:root[data-theme="dark"]` and `:root[data-theme="light"]` so the viewer's
  toggle wins in both directions.
- **Single-mode theme** (all the rest) → one committed palette with a comment
  saying so. No inversion is invented.

## to-frame (spec only)

HyperFrames `frame.md` declares palette and type **by role**, in container-query
units. Mapping:

| design-kit | frame.md role |
| --- | --- |
| `ground` | `bg` |
| `ink` / `ink-soft` / `ink-faint` | `fg` (+ alpha variants `fg8`/`fg15`) |
| `accent` | `ac` (+ `ac3`/`ac5`/`ac25` alpha steps) |
| `emphasis[n]` | secondary accents in declaration order |
| `font.display/body/mono` | `display`/`body`/`mono` families |
| `_motion.yaml` durations | **converted to whole frames at project fps** |

Frame conversion (from `_motion.yaml`): at 30fps `fast≈5f base≈10f slow≈21f`; at
60fps `11f / 19f / 42f`. Round to whole frames — a fractional frame is a dropped
frame. Type sizes convert to `cqw` against the composition width, not px.
**Unexecuted:** needs a real HyperFrames project to compile against.

## to-pptx (spec only)

`python-pptx` is **not installed** here, so this is a mapping, not a script:

| design-kit | pptx theme slot |
| --- | --- |
| `ground` | `lt1` (background) |
| `ink` | `dk1` (text) |
| `raise` | `lt2` |
| `ink-soft` | `dk2` |
| `accent` + `emphasis[0..4]` | `accent1`…`accent6` |
| `font.display` | major latin typeface |
| `font.body` | minor latin typeface |

Two constraints a deck author must respect: PowerPoint has **no motion tokens**
(the reveal choreography does not survive the trip — rebuild it with entrance
animations or accept static), and embedding a face that isn't open-source in a
`.pptx` you send out is the same redistribution problem as an artifact, so a
`source: local` pairing like that must use the `shared_surface_alternate`
there too.

To make this executable: `pip install python-pptx`, then generate the theme part
from the same token block. Do not claim it works until it has run.
