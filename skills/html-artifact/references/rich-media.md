# Rich media — images, text effects, code, data display

## Images

Remote images are blocked. Four options, in order of preference:

**1. Draw it as SVG.** Diagrams, logos, icons, decorative geometry. Themeable
via `currentColor`, sharp at any zoom, kilobytes. Nearly always right.

**2. CSS gradients and patterns.** Backgrounds, texture, depth — zero payload.

```css
.grid-bg{background-image:
  linear-gradient(var(--rule-soft) 1px, transparent 1px),
  linear-gradient(90deg, var(--rule-soft) 1px, transparent 1px);
  background-size:32px 32px}
.glow{background:radial-gradient(60% 60% at 30% 20%, var(--accent-bg), transparent 70%)}
```

**3. Inline a data URI** when a real photograph or an existing asset is needed:

```html
<img src="data:image/webp;base64,UklGR…" alt="What it shows and why it matters" width="800" height="450">
```

Read the local file, base64 it, paste it. Budget: base64 inflates by ~33%, and
the page ceiling is 16 MB. WebP or AVIF over PNG for photographs; SVG for
anything vector. **Always set `width`/`height`** — without them the page reflows
as images decode.

**4. Canvas**, for generative or data-driven visuals — particle fields, noise,
plots. No library, and it respects the theme if you read tokens:

```js
const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
```

**Alt text carries the claim**, exactly like a `figcaption`: what the image
shows and why it is here. `alt="screenshot"` is the same as no alt. Purely
decorative graphics get `alt=""` so screen readers skip them.

## Text effects

Restraint is the whole game. One characterful treatment on a page reads as
designed; three read as a template.

**Gradient headline** — works on both grounds if built from tokens:

```css
.grad{background:linear-gradient(92deg, var(--ink), var(--accent) 70%);
      -webkit-background-clip:text;background-clip:text;color:transparent}
```

**Split-text reveal** — the effect worth having. Wrap words at runtime, then
stagger. Keep the accessible text intact by animating spans, not by replacing
content:

```js
function splitWords(el){
  el.innerHTML = '';                                    // safe: we re-add text nodes only
  (el.dataset.text || '').split(/\s+/).forEach((w,i) => {
    const s = document.createElement('span');
    s.className = 'w'; s.style.setProperty('--i', i); s.textContent = w + ' ';
    el.appendChild(s);
  });
}
```

```css
.w{display:inline-block;opacity:0;transform:translateY(.5em);
   animation:wordIn .5s cubic-bezier(.2,.7,.3,1) forwards;
   animation-delay:calc(var(--i) * 45ms)}
@keyframes wordIn{to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.w{opacity:1;transform:none;animation:none}}
```

Words, not characters. Per-character reveals on a headline read as a title
sequence and delay comprehension.

**Counting numbers** — see `motion.md`. One per page.

**Typewriter, marquee, glitch, 3D flip** — almost always wrong for a technical
deck. They cost reading speed and buy novelty. Use only where the subject
genuinely calls for it (a terminal piece, a launch teaser).

## Code blocks

Code appears constantly in technical artifacts. Get it right:

```css
pre{margin:0 0 12px;padding:14px 16px;background:var(--sunk);
    border:1px solid var(--rule-soft);overflow-x:auto;
    font-family:var(--mono);font-size:12.5px;line-height:1.55;tab-size:2}
pre .add{color:var(--accent)} pre .rem{color:var(--alert)} pre .cm{color:var(--ink-faint)}
```

**Do not inline a syntax highlighter.** Hand-mark the three things that carry
meaning — added, removed, comment — with spans. It is smaller, themeable, and
directs attention to the diff rather than colouring forty tokens uniformly.

Escape `<`, `>`, `&` inside `<pre>`. An unescaped `<` swallows the rest of the
block, and it will look like a CSS bug.

## Data display

**Tables** — `tabular-nums` on numeric columns, right-align them, wrap wide
tables in `.scroll`. A sticky header earns its place past ~15 rows:

```css
thead th{position:sticky;top:0;background:var(--ground);z-index:1}
```

**Inline bars** beat a chart library for a handful of comparisons:

```html
<td><span class="bar" style="--v:64%"></span><span class="n">64%</span></td>
```
```css
.bar{display:inline-block;height:6px;width:var(--v);background:var(--accent);
     vertical-align:middle;margin-right:8px;min-width:2px}
```

**Sparklines** as a hand-authored `<polyline>` — ~200 bytes, themeable,
accessible with a `role="img"` label. See `svg-diagrams.md`.

**Stat tiles** encode state in form as well as number — a semantic colour, a
chip, a severity stripe — so what needs attention reads at a glance without
being read.

## Sound, video, motion assets

Audio and video must be inlined as data URIs and are heavy; a 30-second clip
blows the budget. Prefer an animated SVG or Canvas loop. If video is genuinely
required, the artifact is probably the wrong format — link out instead.
