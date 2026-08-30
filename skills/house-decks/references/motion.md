# Motion layer — fragment stepping + curated primitives

Opt-in, additive layer on top of `deck-stage.js` and `deck-anim.js`. Neither of
those two files is edited by this layer — everything here lives in three new
sibling files that hook `deck-stage`'s `slidechange` event from outside.

## Opting a deck in

Add these tags, in this order relative to the existing tail scripts (after
`deck-anim.js`, before any inline/tweaks-panel script):

```html
<head>
  ...
  <link rel="stylesheet" href="deck-motion.css">
</head>
<body>
  ...
  <script src="deck-stage.js"></script>
  <script src="deck-anim.js"></script>
  <script src="deck-fragments.js"></script>
  <script src="deck-motion.js"></script>
  <!-- inline script / tweaks-panel.jsx, unchanged -->
</body>
```

All four (`deck-stage.js`, `deck-anim.js`, `deck-fragments.js`, `deck-motion.js`)
listen for the same `slidechange` event independently — order between the
last two doesn't matter functionally, but keep them together and after
`deck-anim.js` so the tail reads as "core → motion add-ons".

`deck-motion.css` is **not** linked by the default `deck.html`/`deck.css` (the
starter's inline `<style>` is self-contained) — you must add the `<link>`
yourself. `deck-fragments.js` and `deck-motion.js` are true no-ops when a deck
doesn't use their opt-in attributes (`[data-fragments]` / `[data-count-honest]`
respectively), so it's safe to add the tags to every deck by default if you
want the option available without committing to using it.

## Optional: the 3D page turn

A separate, independently opt-in transition — `deck-pageturn.css` +
`deck-pageturn.js`. Not part of the three primitives below and not on by default,
because it changes how *every* navigation in the deck feels and that is a
deliberate choice, not a default.

**Turn it on** with an attribute on the stage, plus the two files:

```html
<head>
  <link rel="stylesheet" href="deck-pageturn.css">
</head>
<body>
  <deck-stage width="1920" height="1080" data-pageturn>
  ...
  <script src="deck-stage.js"></script>
  <script src="deck-anim.js"></script>
  <script src="deck-pageturn.js"></script>
</body>
```

Both files are inert without `data-pageturn`, so they are safe to link in every
deck to keep the option available.

**When to use it.** A workshop or a narrative deck read front-to-back, where the
page metaphor is doing work. Skip it for a dashboard-ish or reference deck people
jump around in — a 0.9s turn on every rail click becomes friction fast.

**The mechanic, and the trap.** The OUTGOING sheet turns away on its spine and
uncovers the next page; the arriving page does not move and does not fade. The
tempting version is the reverse — rotate the *incoming* slide in from
`rotateY(32deg)` — and it is one rule shorter, but it reads as a card flipping
toward the viewer rather than paper, because paper does not swing into place: the
sheet on top of it moves out of the way. **This is the single most common reason a
"page flip" does not feel like a page, and it is invisible in code review, since
both versions are just a `rotateY`.**

Three things carry the illusion; dropping any one collapses it:

1. **One sheet moves.** The incoming page is static and already painted.
2. **The hinge is an edge**, never the centre.
3. **The turning sheet is opaque.** A transparent one lets the page beneath show
   through mid-turn, which reads as a double exposure. `deck.css`'s `.slide`
   already sets `background: var(--bg)`; a deck with transparent slides must set
   one or the turn looks broken in a way that is hard to name.

**Two things it also fixes, which are easy to miss.** Backward navigation replays
every `[data-deck-active]`-gated entrance (`.reveal`, `.pop`, `[data-frag]`) as if
the slide were new — get the geometry right and going back *still* feels wrong
until those are held at their final state, which the stylesheet does. And
`deck-stage` drops `[data-deck-active]` from the outgoing slide instantly, so
there is no "leaving" state to style at all; `deck-pageturn.js` exists only to
supply one (`.is-turning-out`) and clear it when the turn ends. It also clears a
turn still in flight — without that, a fast click-through pins a half-turned
sheet at `z-index: 3` and the deck looks frozen on a slide you already left.

**Numbers are not round on purpose.** `-76deg` not `-90` (at 90 the sheet is
edge-on and vanishes into a line, which reads as a wipe); opacity holds until the
last third so it is a turn rather than a fade wearing a rotation; `0.9s` is slower
than `--mo-slow` because a page has mass and a fast page turn reads as a glitch.

**Verify it by looking, not by reading the CSS.** Screenshot mid-turn (~330ms in)
and check three things: only one sheet is moving, the hinge is on an edge, and no
text is doubled. The doubling failure in particular passes every structural check
and is obvious in one frame.

Interaction: honours `html.motion-off`, `html.dk-no3d` and
`prefers-reduced-motion: reduce` — under any of those, navigation falls back to
deck-stage's plain cut. Direction comes from `data-dk-dir` on `<html>`;
`deck-console.js` already writes it when a deck ships the console, and
`deck-pageturn.js` only fills it in when nothing else has, so there is never a
second competing direction signal.

## Motion tokens

Canonical cross-surface values (design-kit schema) — use exactly these names:

```css
:root{
  --mo-fast:180ms; --mo-base:320ms; --mo-slow:700ms;
  --mo-ease:cubic-bezier(.2,.7,.3,1);
  --mo-ease-out:cubic-bezier(.16,1,.3,1);
  --mo-stagger:85ms;
}
```

Defined once in `deck-motion.css`'s `:root`. Don't redeclare them in a deck's
own `<style>` block; override a specific token there only if a deck genuinely
needs a different pace (rare — most decks should just take the defaults).

## The three primitives

All three are gated on `[data-deck-active]` and disabled under
`prefers-reduced-motion: reduce` or `html.motion-off`, matching
`deck-anim.js`'s own `motionOK()` gate. The ungated/base rule for each is
always the fully-visible end-state, so print, no-JS, and reduced-motion all
render correctly with zero JS.

### 1. Fragment reveal

The transition applied to `[data-frag]` as it becomes revealed: opacity +
small `translateY`, over `--mo-base` on `--mo-ease`. See "Fragment vocabulary"
below for the full authoring contract. This is the one primitive driven by a
JS *state toggle* (deck-fragments.js adding/removing `data-frag-pending`)
rather than firing once on slide entry, so it uses a CSS `transition`, not
`@keyframes` — a plain `transition` doesn't reliably animate an element that
is *becoming newly gated* in the same style recalc (that's why `.reveal`/
`.pop`/`.kicker-line` all use `animation` instead), but it's exactly the
right tool for "this attribute changed while the slide was already active."

### 2. SVG draw-in

`data-anim="draw"` on the `<section>` (same place as `data-anim="terminal"`/
`"query"` — one `data-anim` value per slide). Diagrams building as the
presenter explains them is the one place motion carries real information, so
this is the one primitive worth the extra authoring step:

- Normalize every path you want to draw with `pathLength="1"` so
  `stroke-dasharray`/`stroke-dashoffset` are plain `0..1` values, no
  `getTotalLength()` JS needed:
  ```html
  <section class="slide" data-anim="draw" data-label="Architecture">
    <svg viewBox="0 0 400 200">
      <path pathLength="1" d="M20,100 L200,100" style="--d:0"/>
      <path pathLength="1" d="M200,100 L380,40" style="--d:0.3"/>
      <path pathLength="1" d="M200,100 L380,160" style="--d:0.3"/>
    </svg>
  </section>
  ```
- Stagger multiple paths with `style="--d:0.3"` (seconds, like the deck's
  existing `--d` idiom on `.eqbox`).
- Draws over `--mo-slow` on `--mo-ease-out`. Paths without `pathLength` are
  left alone (decorative dash-loop paths like `.pkt` are unaffected).

### 3. Comparison split

For the `s-pattern` before/after archetype (see `grammar.md`): the two panels
enter from their own sides, `--mo-base` apart, so the *contrast itself* is
what animates. Two selector forms are provided, both additive:

- Structural: `.s-pattern > .left` (enters from the left) and its immediate
  next sibling (enters from the right) — matches the real-world `.s-pattern`
  markup in existing decks (a `.left` column plus one sibling panel).
- Class-based: `.pattern-box.before` / `.pattern-box.after`, matching
  `grammar.md`'s originally-documented (but not yet used in practice)
  `.pattern-box` naming, for decks that adopt it.

Caution: `animation` on `.left` applies a `transform`, which creates a new
containing block for the duration of the entrance — if a slide puts a
`position:absolute` descendant inside `.left`, it will jump during entry.
Avoid absolutely-positioned children of `.left`/`.pattern-box` panels, or
give them their own `animation` instead of relying on the parent's.

## Fragment vocabulary

Opt in per slide with `data-fragments`; mark children with `data-frag="N"`
(same integer number = revealed together, in one step):

```html
<section class="slide" data-fragments data-label="Rollout plan">
  <h1 class="reveal" style="--i:1">Rollout plan</h1>
  <ul>
    <li data-frag="1">Phase 1 — pilot team</li>
    <li data-frag="2">Phase 2 — department</li>
    <li data-frag="3">Phase 3 — company-wide</li>
  </ul>
</section>
```

- Unmarked content and `data-frag="0"` show immediately on slide entry.
- Forward key (→ / PageDown / Space) reveals the next group; once every group
  is revealed, the same key falls through and advances to the next slide.
- Backward key (← / PageUp) un-reveals the last group; at group 0 the same
  key falls through to the previous slide.
- Home/End/digit-key/R jumps are **not** intercepted — those are direct
  navigation, not incremental pacing, and always land on a slide in its
  fully-appropriate state per the re-entry rule below.
- Re-entering a fragmented slide always resets deterministically: entering
  it moving *forward* starts collapsed (group 0); entering it moving
  *backward* shows it fully revealed. It never resumes mid-way where you left
  it — "going back to a finished slide shows it finished, not blank."
- Printing/PDF export reveals every fragment on every fragmented slide (see
  `export.md`) and is unaffected by fragment state.

### Programmatic API

```js
window.deckFragments = {
  next(),   // reveal the next group; returns false if already fully revealed
  prev(),   // un-reveal the last group; returns false if already at group 0
  state(),  // -> { slide, group, groups }
};
```

`state().slide` is the **0-based slide index** (`-1` if the active slide
isn't fragmented), not the DOM element — deliberately, so `state()` is
JSON-serializable for scripted/automated testing (e.g.
`document.title = JSON.stringify(window.deckFragments.state())`, read back
via a headless `--dump-dom`). `groups` is the highest `data-frag` value on
the active slide (`0` when the active slide has no fragments, or when no
slide is active yet). `window.deckFragments` is **always defined**, even in
a deck with zero `[data-fragments]` slides — call `state()` freely to check
`groups === 0` rather than checking for the global's existence.

## The count-up conflict (read this before adding stats)

`deck-anim.js`'s existing `[data-count]` count-up animates **from 0**. The
`visual-verify` skill's honest-quantity rule requires a count-up to climb
from a floor of 1 toward the target and never overshoot the claim — a 0
under a label claiming a real quantity is a false frame for however briefly
it's on screen, and no mid-tween value may exceed the labeled target.

**INTENT: code does** `deck-anim.js`'s `countUp()` animates every
`[data-count]` element from 0, unconditionally **/ check expects** a
count-up must never render 0 under a real-quantity label (visual-verify's
honest-quantity rule) **/ spec says** `deck-anim.js` is canonical for this
Phase and must not be edited. These two house rules govern the same
attribute and disagree; they are not resolved here — a human should decide
whether to retire the from-0 behavior in `deck-anim.js` itself.

Until that decision is made, this layer adds a **parallel, opt-in**
attribute instead of touching `deck-anim.js`:

- `data-count-honest="48"` — put the target value directly in the attribute
  (not in `data-count`). `deck-motion.js` animates it from a floor of 1 up to
  the target, clamped so it never exceeds the target, and shows the target
  exactly (no rounding drift) at the end.
- **Do not also set `data-count` on the same element.** `deck-anim.js`'s
  selector (`.statstrip .stat .n[data-count]`) and `deck-motion.js`'s
  `[data-count-honest]` handler would both start independent
  `requestAnimationFrame` loops against the same `textContent` if an element
  carried both. `deck-motion.js` detects this and skips with a
  `console.warn` rather than guessing which one should win — it does not
  silently pick a winner.
- A target of `0` (or negative) is rendered directly, with no animation and
  no floor-of-1 — a floor of 1 would itself overshoot a claim of 0.

Markup is otherwise identical to the existing convention (`data-final` /
`data-suffix` supported the same way):

```html
<div class="stat">
  <span class="n" data-count-honest="48">48</span>
  <span class="l">commands</span>
</div>
```

**Until a human retires the from-0 behavior, both conventions coexist:**
existing decks/slides keep using `[data-count]` unchanged; new stats that
care about the honest-quantity rule use `[data-count-honest]`.
