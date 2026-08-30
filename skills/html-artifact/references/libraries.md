# Libraries — GSAP, Three.js, and the inline-or-nothing rule

## The rule

A CDN `<script src="https://…">` is **blocked**, silently. The page loads, the
library is undefined, your animation never runs, and nothing appears in the
viewer's console. This is the single most common way an artifact ships broken.

**A library is usable only if you paste its source into the page.** Read the
minified file from disk and inline it. There is no other path.

```html
<script>/* ——— gsap 3.13.0 (inlined; CSP blocks CDNs) ——— */
!function(t,e){"object"==typeof exports&&…   /* the whole minified file */
</script>
<script>
  gsap.to('.hero', { opacity: 1, duration: .6, ease: 'power2.out' });
</script>
```

## Budget

Page limit is 16 MB including everything. Measured from a local vendored copy:

| Library | Minified | Verdict |
| --- | ---: | --- |
| GSAP core | **72 KB** | Free. Inline without thinking about it. |
| GSAP ScrollTrigger | **44 KB** | Fine, if you actually scroll-trigger something. |
| Three.js (module build) | **1.2 MB** | Works, but it is 7% of budget for one effect. Justify it. |
| OrbitControls | 32 KB | Only with Three. |

If a project already vendors these (a `vendor/` directory next to the page,
usually populated by a fetch script), read from there rather than asking the
user for a copy.

## Do you need GSAP?

Usually not. CSS keyframes and the Web Animations API cover most deck motion at
zero weight, and `references/motion.md` has the patterns. GSAP earns its 72 KB
when you need:

- **A timeline** — several elements choreographed on one clock, scrubbable and
  reversible. Hand-rolled `setTimeout` chains are where this goes wrong.
- **ScrollTrigger** — pinning, scrubbing an animation to scroll position,
  progressive reveal tied to viewport progress. Genuinely painful without it.
- **Physics-adjacent easing** and stagger grids that would be dozens of CSS rules.

Reach for it deliberately. A fade-in does not need a library.

```js
// timeline: the case that justifies the weight
const tl = gsap.timeline({ defaults:{ ease:'power2.out' } });
tl.from('.hero-title', { y: 24, opacity: 0, duration: .6 })
  .from('.hero-sub',   { y: 16, opacity: 0, duration: .5 }, '-=.35')
  .from('.hero-stat',  { y: 12, opacity: 0, stagger: .07 }, '-=.3');
```

```js
// per-slide replay in a deck — kill and rebuild, don't stack timelines
let tl;
function animateSlide(el){
  tl && tl.kill();
  tl = gsap.timeline();
  tl.from(el.querySelectorAll('[data-anim]'), { y:14, opacity:0, stagger:.08, duration:.5 });
}
```

**Always gate it:**

```js
if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  gsap.set('[data-anim]', { clearProps: 'all' });   // show the end state
} else { animateSlide(slide); }
```

## Three.js and 3D

Viable, and occasionally the right answer — a hero that shows a spatial idea
(a network, a layered architecture, a globe). But be honest about the trade:
1.2 MB, a WebGL context, and a device-performance question on every viewer's
machine.

**Prefer, in order:**

1. **Inline SVG** with depth cues — layered translucent planes, an isometric
   grid, a drop shadow. Reads as dimensional at ~2 KB.
2. **CSS 3D transforms** — `perspective` + `rotateX/Y` on real DOM. Genuinely
   three-dimensional, themeable, accessible, no library.
3. **Canvas 2D** — particles, generative fields, data-driven visuals. No library.
4. **Three.js** — only when actual geometry, lighting or camera movement is the
   point.

```css
/* layered depth without WebGL */
.stack{perspective:1200px}
.stack-layer{transform:rotateX(58deg) rotateZ(-32deg) translateZ(var(--z));
             transform-style:preserve-3d}
```

If you do ship Three: `powerPreference:'low-power'`, cap `setPixelRatio` at 2,
pause the render loop when the tab or slide is hidden, and provide a static SVG
fallback when `WebGLRenderingContext` is missing. A hero that spins forever on a
laptop battery is a bad guest.

```js
if (document.hidden || !slide.classList.contains('on')) return;  // in the RAF loop
```

## Anything else

Same rule: inline or don't use it. Chart libraries are rarely worth their weight
— hand-authored SVG (`references/svg-diagrams.md`) gives better typography and
theme integration than a generic charting default, at a fraction of the size.
Markdown parsers, date libraries and icon fonts are almost never justified;
write the markup, use `Intl`, draw the icon.
