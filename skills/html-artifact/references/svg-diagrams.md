# SVG — heroes, architecture, sequences, before/after

Hand-author inline `<svg>` with native shapes. No libraries, no runtime, no
external images. A diagram earns its place when it lets a cold reader see a
mechanism they would otherwise assemble from prose. If a sentence is faster,
write the sentence.

## Frame

```html
<figure>
  <div class="scroll">
    <svg viewBox="0 0 1120 330" width="1120" role="img"
         aria-label="One sentence stating what the picture shows.">…</svg>
  </div>
  <figcaption>The claim the figure makes, in a line.</figcaption>
</figure>
```

```css
.scroll{overflow-x:auto}
svg{max-width:100%;height:auto;display:block}
.scroll > svg{min-width:640px}      /* scroll instead of shrinking labels to 6px */
```

`min-width` is the rule people skip. Without it, `max-width:100%` squeezes a
1120-wide diagram onto a phone and every label becomes unreadable. Scrolling a
diagram is fine; illegible text is not.

## Color

Strokes and text in `currentColor` inherit the page foreground and theme
automatically. Reserve a literal hue for the element that carries meaning —
the option being recommended, the hop under discussion, the thing that breaks.
CSS custom properties work in SVG presentation attributes:

```html
<rect fill="var(--accent-bg)" stroke="var(--accent)" stroke-width="1.4"/>
```

Check the accent on both grounds. A hue that sings on paper can vanish on slate.

## Arrowheads

```html
<defs>
  <marker id="a1" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0 0 L10 5 L0 10 z" fill="currentColor"/>
  </marker>
</defs>
<line … marker-end="url(#a1)"/>
```

Marker `fill` does **not** inherit from the referencing line — a coloured arrow
needs its own marker (`a1`, `a1p`, `a1e`). Ids are document-global: with several
diagrams on one page, prefix per figure or they collide silently and every arrow
takes the first definition's colour.

## Architecture diagrams

Show the boundary being crossed, the hop being added, the data that moves.
Leave out what the argument does not turn on.

- Group deployment/ownership boundaries in a dashed container with a small
  uppercase label. Ownership is usually the thing readers get wrong.
- Label every arrow — `writes`, `polls every 60s`, `8 ops`. An unlabelled arrow
  says "related somehow".
- Put a one-line "what actually moved" strip under the after-diagram. It stops
  the reader diffing two pictures by eye.

**Before/after:** keep the two drawings on the *same grid* — same box sizes,
same positions, same order. The reader should be able to flip between slides and
see only the delta move. Redrawing the layout hides the change you are making.

## Sequence diagrams

Better than a flowchart whenever call *count* or *order* is the point.

```html
<line x1="118" y1="32" x2="118" y2="196" stroke="currentColor" opacity=".35"/>  <!-- lifeline -->
<line x1="118" y1="66" x2="466" y2="66" stroke="var(--warn)" stroke-width="1.3"/>
<text x="126" y="61" font-size="9.5" fill="var(--warn)">1 · POST /token</text>
```

- Number the steps. In a sequence, order *is* the information.
- Label above the line, left-aligned at the origin lifeline.
- Put before and after side by side at the same vertical rhythm — "five calls
  become two" should be visible before it is read.
- Call out what is dropped or gained in a boxed strip beneath, in the semantic
  colour. Silent discards (a field validated then thrown away) are exactly what
  a sequence diagram is for.

## Text must fit its box — SVG will not tell you

SVG has **no text wrapping and no overflow warning**. A `<text>` wider than its
`<rect>` simply draws over whatever is next to it, and it renders "fine" at every
zoom level — so it survives review and ships.

Estimate before you draw: at `font-size:N` in a monospace face, a string of
`c` characters is roughly **`c × N × 0.6` px** wide. Compare that against the
rect width, and leave ~16px of padding.

```
"stid.stid_configuration · stid_mercury_card"   43 chars × 11px × 0.6 ≈ 284px
<rect width="276">                              → overflows, collides with the
                                                   label to its left
```

Fixes, in order of preference: **split onto two `<text>` lines** (and grow the
rect's height), shorten the label, or widen the rect. Dropping the font size is
the last resort — 9px is already the floor for a projected diagram.

Two lines cost nothing and usually read better:

```html
<rect x="424" y="244" width="228" height="76" …/>
<text x="538" y="264" text-anchor="middle">stid.stid_configuration</text>
<text x="538" y="280" text-anchor="middle">stid.stid_mercury_card</text>
```

**Check every label that sits near another element.** Collisions happen at the
edges — a centred label overflowing into a connector's caption is the classic.

## Text

11–13px at drawn scale. Short labels — a word or three. Explanatory sentences
belong in the caption. `text-anchor="middle"` for centred box labels; align to
a shared grid, because even gaps are most of what makes a hand diagram read as
deliberate.

`<tspan font-weight="600">` for emphasis inside a `<text>`; there is no inline
markup in SVG.

## Constraints

No `<script>`, `<style>` or `<foreignObject>` inside the SVG. Gradients,
patterns and `<use>` reference ids in the same fragment. Long decorative path
data means the drawing wants a real graphics tool — simplify instead. For
generative or particle-like visuals reach for Canvas rather than hand-authoring
hundreds of nodes.
