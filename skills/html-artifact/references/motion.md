# Motion

Motion earns its place by directing attention or showing a mechanism. Ambient
movement with no referent is the fastest way to make a page read as generated.

## Use the shared motion tokens

Durations and curves live once, in `design-kit/themes/_motion.yaml`, and are
emitted by every `dk.py compile` run — so an artifact reveal and a deck reveal
move identically, which is most of what makes two different media feel like one
system:

```css
--mo-fast:180ms;  --mo-base:320ms;  --mo-slow:700ms;
--mo-ease:cubic-bezier(.2,.7,.3,1);  --mo-ease-out:cubic-bezier(.16,1,.3,1);
--mo-stagger:85ms;   /* the --i multiplier; beyond ~7 items the tail reads broken */
```

Reach for `--mo-fast` for a state change nobody should wait on, `--mo-base` for
reveals and entrances, `--mo-slow` for one deliberate beat per page.

**Never front-load.** The doctrine travels with the tokens: firing a whole page's
stagger on load and then sitting there is the failure mode — not stillness. Pace
reveals to the reader's scroll (or the speaker, on a deck). Once content has
resolved, let it hold and be read.

## Per-slide re-trigger

A CSS animation restarts when its element goes from `display:none` to visible.
That is the whole mechanism behind slide entry — no JS, and it replays every
time the reader returns to the slide.

```css
[data-anim]{opacity:0;transform:translateY(12px)}
.on [data-anim]{animation:rise .55s cubic-bezier(.2,.7,.3,1) forwards}
.on [data-anim="1"]{animation-delay:.04s}
.on [data-anim="2"]{animation-delay:.12s}
.on [data-anim="3"]{animation-delay:.20s}
@keyframes rise{to{opacity:1;transform:none}}
```

Numbered stagger beats `:nth-child` — you control which elements lead, and
reordering markup does not reshuffle the choreography. Keep total stagger under
~450ms; past that a returning reader is waiting on the deck.

## Drawing an SVG path

```css
.on .draw{stroke-dasharray:var(--len);stroke-dashoffset:var(--len);
          animation:draw .9s ease forwards}
.on .draw.b{animation-delay:.3s}
.on .draw.c{animation-delay:.6s}
@keyframes draw{to{stroke-dashoffset:0}}
```

```html
<line class="draw b" style="--len:352" x1="118" y1="92" x2="466" y2="92" …/>
```

`--len` needs to be roughly the path length — over-estimating is safe (the line
starts fully hidden and lands on time), under-estimating leaves a visible stub.
For straight lines use the pixel distance; for curves add ~15%.

**Only define the dash properties inside `.on`.** If `.draw` carries them
unconditionally, a diagram on an inactive slide — or on a page with no deck —
renders permanently invisible.

Sequence the draw order to match reading order. A flow that draws left to right
teaches the flow; one that draws all at once is decoration.

## Counters

```js
let n = 0, step = Math.max(1, Math.round(target/28));
const t = setInterval(()=>{ n += step; if (n>=target){ n=target; clearInterval(t);} el.textContent = n; }, 26);
```

Use for one number that carries weight — a deadline, a count that should feel
large. Two counters on a page compete; five are noise.

If the number is a *date-derived* countdown, compute it rather than hardcoding,
or it silently goes stale the day after you publish:

```js
const days = Math.max(0, Math.ceil((Date.parse('2026-09-30') - Date.now()) / 864e5));
```

## Reduced motion

Every animated rule needs a counterpart. Missing this is an accessibility
failure, and for vestibular-sensitive readers a genuinely unpleasant one.

```css
@media (prefers-reduced-motion:reduce){
  [data-anim],.on [data-anim]{opacity:1;transform:none;animation:none}
  .on .draw{animation:none;stroke-dashoffset:0}
  .prog{transition:none}
}
```

Note `stroke-dashoffset:0` — `animation:none` alone would leave the path hidden
at its start value. Reduced motion must show the *end* state, not no state.

Gate JS-driven motion too:

```js
const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (rm) el.textContent = target;   // skip the count, show the number
```

## Restraint

- One orchestrated moment beats scattered effects.
- Hover states on things that are actually interactive; nowhere else.
- No parallax, no scroll-jacking, no auto-advancing slides.
- If motion cannot be described in terms of what it reveals, cut it.
