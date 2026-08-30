---
name: visual-verify
description: "Render a visual deliverable and look at it before claiming it works — HTML pages, charts, SVG diagrams, decks, canvas/WebGL/Three.js scenes, animated hero sections, scroll-driven narratives. Use when you have built or changed anything whose output is seen rather than read, when a user says a visual 'looks wrong / doesn't look good / is misaligned', or before reporting any visual work as done. Also carries the honest-quantity-encoding rules (never draw N marks and label them 10N) and a table of layout traps that only appear at render time."
trigger: /visual-verify
---

# /visual-verify

**Role.** You are shipping something a human will *look at*: a page, a chart, a diagram, a deck slide, a 3D scene. Your usual proof — "it compiles, the tags balance, the script parses" — proves nothing about whether it looks right. This skill is the render-and-look loop that closes that gap.

**Context.** Three invariants drive everything below.

1. **A visual deliverable is not done until you have seen it.** Structural validation cannot detect overlapping text, a camera inside its own geometry, dots labelled with the wrong number, or a legend wrapping into an 8-character column. All of those ship green.
2. **You can almost always render locally.** A Chromium binary is usually cached on the machine even when Playwright itself is not installed. Software WebGL works.
3. **Animation state is invisible to a timed screenshot.** This is the trap that costs the most time — see [The settle problem](#the-settle-problem).

**Task.** Build → render → *look* → instrument what you cannot see → force the settled state → re-look → only then report. Never collapse this into build → validate → report. How much of this loop a given change requires — one shot vs. the full cartesian matrix — depends on the [verification tier](#9-verification-tiers); §9 defines the three tiers and when each applies.

---

## 1. Render it

`scripts/render.sh` wraps the whole invocation. Manually, the shape that works:

```bash
CH="$HOME/Library/Caches/ms-playwright/chromium-<ver>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"

"$CH" --headless=new --disable-gpu --enable-unsafe-swiftshader \
  --hide-scrollbars --window-size=1500,1000 \
  --virtual-time-budget=3000 \
  --screenshot=/path/out.png \
  --allow-file-access-from-files \
  "file:///abs/path/page.html"
```

Flags that matter, and why:

| Flag | Why it is not optional |
| --- | --- |
| `--enable-unsafe-swiftshader` | Software WebGL. Without it a `<canvas>` 3D scene silently renders nothing. |
| `--allow-file-access-from-files` | `file://` pages that load local assets or ES modules. |
| `--hide-scrollbars` | Otherwise a scrollbar gutter shifts your layout measurements. |
| `--window-size=W,H` | The screenshot is **viewport-only**. To capture a long page, set `H` to the document height. |
| `--virtual-time-budget=N` | Fast-forwards timers so the page settles. **Does not reliably advance rAF-driven animation** — see §3. |

**Long pages.** Measure the height first, then crop into readable segments — a 4000px-tall screenshot is unreadable when viewed:

```bash
# 1. measure
#    inject: setTimeout(()=>{document.title='H='+document.documentElement.scrollHeight},2000)
"$CH" ... --dump-dom "file://$T/measure.html" | grep -o '<title>[^<]*</title>'
# 2. shoot at full height, then crop (macOS, no PIL needed)
sips -c 1080 1400 --cropOffset 1050 0 full.png --out seg0.png
```

---

## 2. Look at it

Read the PNG back. Do not skim it — check specifically for:

- text crossing other text, or crossing graphics
- anything clipped at a container edge
- elements that are absent entirely (the most common failure, and invisible to validators)
- an element whose *size* contradicts its meaning
- empty regions that make a multi-column layout look unbalanced

## 3. The settle problem

**GSAP, and any rAF-driven animation, does not complete under `--virtual-time-budget`.** Its clock advances from `requestAnimationFrame` timestamps, which the virtual-time fast-forward does not feed proportionally. A screenshot at t=16s can catch a 1s tween at 35% progress.

Symptoms that mean "settle problem", not "bug":

- a count-up showing a nonsense intermediate value (`807` under a label claiming `1`)
- elements at partial opacity for no reason
- a camera or transform stuck partway to its target

### Two capture strategies — choose, do not default

There are two ways out of this, and they are not ranked. Picking the wrong one
gives you a confident screenshot of a state that never existed.

| Strategy | How it settles the page | Use it for | Structurally blind to |
| --- | --- | --- | --- |
| **force-final-state** — `scripts/settle-template.js` | Stops the animation engine, then assigns every animated value its final value. | The **end state** of a static or single-state page. Fast, deterministic, no live session. | Every intermediate state. It *manufactures* an end state rather than observing one, so a bug in how the page gets there is invisible. |
| **wait-for-convergence** — `scripts/converge.sh` | Lets the page run in **real time** and polls `document.getAnimations()` until it has arrived — once per sampled position. | **Many points along a timeline**: a scroll narrative, a multi-step animation, a deck transition. Each position gets its own settled frame. | Nothing about the timeline — but it spends real wall-clock time and needs a live DevTools session. |

**Neither replaces the other.** On a one-state page, convergence mode is slower
and buys nothing. On a scroll narrative, force-final-state can only ever show
you the bottom of the page. Say which strategy produced a frame when you report
it — they support different claims.

### Strategy 1 — force-final-state

**Force the settled state in a throwaway copy.** Never edit the real file for this.

```js
setTimeout(function(){
  gsap.globalTimeline.pause();      // stop tweens from overwriting what you set
  /* now assign every animated value its FINAL value directly */
  renderer.render(scene, camera);   // for canvas: force one frame
}, 900);
```

Inject it, write to `/tmp/verify-<n>.html`, screenshot that. `scripts/settle-template.js` is the scaffold. Verify *each* discrete state (each stage/tab/step) separately — bugs hide in the states you did not look at.

**Order matters inside the settle script, and getting it wrong looks exactly like a bug:**

- **`gsap.globalTimeline.pause()` before `gsap.set()` means the `set` never renders.** `set` is a zero-duration tween on the paused timeline. Either set first then pause, or — for a state you need to be deterministic — **write inline styles directly** (`el.style.transform = 'rotateY(-48deg)'`) and skip GSAP entirely.
- **Pausing before you trigger an interaction strands it mid-tween.** Clicking a tab whose panel animates `fromTo(opacity: 0)` *after* pausing leaves the panel at opacity 0 — it will look like the panel is broken. Trigger the interaction, wait, *then* pause and force opacity.

**`preserveDrawingBuffer: false` (the default) + a one-shot render = blank canvas.** With no rAF loop the buffer is cleared before compositing. This is not only a screenshot artifact: any **`prefers-reduced-motion` path that renders a single frame** ships this bug to real users. If a scene has a static fallback frame, set `preserveDrawingBuffer: true`.

**This is not a GSAP-only problem.** Deck slides have the identical failure mode: a count-up or reveal animation is commonly wired to fire *on slide-enter* (an intersection observer, a `data-active` class toggle, a `slideenter` event), not on page load. A timed screenshot of a slide taken mid-tween — or even a `--states` hash-jump straight to that slide (see [Matrix mode](#10-matrix-mode)) — can catch the counter at a nonsense intermediate value, or catch a card mid-fade at partial opacity, for exactly the same reason a GSAP timeline does: the animation clock is real time, and `--virtual-time-budget` does not feed it proportionally. Apply the same fix — force the final value directly in a throwaway copy — rather than concluding the deck itself is broken.

### Strategy 2 — wait-for-convergence

`scripts/converge.sh` walks a list of scroll offsets, waits at each one until the
page has stopped moving, and shoots that frame. One settled PNG per position,
plus a `report.json` and a `manifest.txt`.

```bash
scripts/converge.sh page.html out/ \
  --offsets 0,700,1600,2600,3220 \
  --viewport 1280x800 \
  --ignore-motion '#scroll-progress'
```

Then read it as one image with the sheet you already have — do **not** build a
second one: `scripts/contact-sheet.sh out/ out/sheet.png`. `baseline.sh` works on
the same directory unchanged.

**It runs in real time on purpose.** Verified (Chromium 151, headless): under
`--virtual-time-budget` every animation reports `playState: "running"` with
`currentTime` pinned at **0 forever** — virtual time never feeds the animation
clock. A convergence wait under virtual time can therefore never converge. This
is the same fact §1's flag table states from the other direction.

**The predicate.** Every animation from `document.getAnimations()` is sorted into
exactly one bucket. Only `moving` blocks the shot; every other non-`settled`
bucket is *reported*, because each one means the frame settled for a reason you
need to know before you trust it.

| Bucket | Meaning | Why it does not block |
| --- | --- | --- |
| `settled` | `playState` is `finished` or `idle`. | Done. (`idle` is defensive — never observed in testing.) |
| `progress` | Driven by a `scroll()` / `view()` timeline. | Its playhead is a pure function of `scrollTop`, so at a stopped offset it is exactly where the reader would see it. Tested **first**, because such an animation reports `endTime` as the `CSSUnitValue` `"100%"` — an endless-check running first would misfile every healthy scroll-driven page. |
| `endless` | `getComputedTiming().endTime` is `Infinity`. | Verified: it stays `running` forever and its `.finished` promise **never resolves**. Waiting on it is an infinite hang. Excluded and named, so you know that frame caught it at an arbitrary phase. |
| `held` | `playState` is `paused`. | It will never advance on its own. Reported, for the same reason. |
| `stuck` | Finite, `running`, playhead unchanged since the last poll. | Only trusted when `document.timeline` itself advanced between the polls — it ticks per frame, not per millisecond, so two polls in one tick make everything look quiet and would fire convergence mid-flight. |

Media is a separate axis: `HTMLMediaElement.seeking` and `readyState >= 2`. An
element with no source is skipped, never waited on.

**On timeout it reports and proceeds — it never hangs and never lies.** The
sample is still captured, `settled` is recorded `false`, and the still-moving
animations are named on stderr and in `report.json`. `converge.sh` exits nonzero
on any unsettled sample: a mid-flight frame is not evidence of an end state.

**Three traps this mode has, stated plainly:**

- **A document-wide scroll-progress bar masks dead-scroll detection.** It advances at every offset by construction, so it separates every pair of samples and an inert region reports clean. `converge.sh` detects this and names the masking component instead of passing — pass the element to `--ignore-motion`.
- **`deadScroll` means something only where the viewport is held.** In a normal flow section, content scrolling past *is* new information, and the signature's text fingerprint sees that — so flow regions are correctly not flagged. The finding is aimed at pinned, sticky and scroll-driven regions, where the viewport stays put and the content is what is supposed to move. Two things follow: a wall-clock animation is excluded from the signature (it would make every pair unique), and on a purely flowing page the check will report itself masked rather than clean.
- **`document.getAnimations()` does not see inside shadow DOM.** Verified. A shadow-root animation is invisible to the wait, so the frame can be captured early with no warning.
- **Pin your offsets.** `--steps N` spaces samples by document length, so adding a section anywhere silently moves every sample and findings come and go with unrelated edits.
- **`--reduced-motion` changes which checks even mean anything, and both say so.** `deadScroll` is **skipped**: with motion off the page is *meant* to hold still, so large regions are legitimately identical and the check would flag the accessibility path as broken on every run. `weakCues` goes **structurally blind** in heuristic mode for the same reason — with `animation`/`transition` switched off there is nothing left to detect, so no element qualifies as a cue. Neither prints a pass: they print `SKIPPED` and `NOT CHECKED` with the reason. Pass `--cues` to grade cues under reduced motion, and check dead scroll in a separate run.
- **Zero tracked cues is never a pass.** "Nothing was weak" and "nothing was looked at" are different answers, so `weakCues` reports `NOT CHECKED` when it tracked no cues at all rather than printing an empty offender list as a clean result.

## 4. Instrument what you cannot see

When something is missing and you cannot tell why, do not guess twice. Push state into `document.title` and read it with `--dump-dom`:

```js
setTimeout(function(){
  document.title = JSON.stringify({
    cam: [camera.position.x, camera.position.y, camera.position.z],
    opacity: shells.map(p => +p.material.opacity.toFixed(3)),
    counts:  shells.map(p => p.geometry.getAttribute('position').count),
    renderPoints: renderer.info.render.points,
    canvas: [renderer.domElement.width, renderer.domElement.height]
  });
}, 3000);
```

```bash
"$CH" --headless=new ... --dump-dom "file:///tmp/diag.html" | grep -o '<title>[^<]*</title>'
```

This is what separates "my code is wrong" from "my measurement is wrong". In one session it proved 1111 points *were* being submitted with correct counts, so the fault was sizing and opacity — not geometry.

**Three counters that will lie to you.** Each of these reported "fine" while the screenshot was blank:

- **`renderer.info.render.points` / `.calls` count what was *submitted*, not what was rasterised.** A scene can report all 14,564 points and 1 draw call and still produce **zero lit pixels**. It only proves the draw reached the GPU.
- **`readPixels` proves rasterisation, not compositing.** It reads the WebGL back buffer. Content can be correct there and still never reach the page — so a `readPixels` probe does *not* validate what a screenshot or a user sees.
- **The only check that proves what the user gets is the canvas image itself**: `canvas.toDataURL('image/png')`, decoded and viewed. Note that headless Chromium sometimes **fails to composite a WebGL canvas into `--screenshot`** even when the buffer is correct — so a blank screenshot with a non-blank `toDataURL` is a harness artifact, not a bug. Say which one you concluded.

**`--dump-dom` serialises markup, not DOM properties.** Setting `textarea.value` in JS does not appear in the dump — the property is not the attribute. Use `element.textContent` for anything you intend to read back out.

**Probe the environment before blaming your code.** Example: if points do not render, check the driver actually supports sized points before rewriting the scene.

```js
var gl = document.createElement('canvas').getContext('webgl2');
document.title = JSON.stringify({range: gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)});
// [1, 1023] => sizing is supported, the bug is yours
```

---

## 5. Honest quantity encoding (non-negotiable)

**Never draw N marks and label them 10N.** Marks are countable, so the eye counts them — a chart drawing 48 dots labelled "~100" and 90 dots labelled "~1,000+" reads as a lie even when nobody counts consciously, and it argues *against* whatever exponential claim the text is making.

Pick an encoding that matches whether the quantity is countable:

| Quantity | Honest encoding |
| --- | --- |
| Small (≤ ~20) | One mark per item. Literal and checkable. |
| Large, exact ratio matters | **Log axis** — 1/10/100/1,000 become evenly spaced rungs, and exponential growth reads as a straight climb. Label the axis logarithmic. |
| Large, in a real renderer | **Draw the true count.** GPU points make 1,000 marks trivial; then the claim is literal geometry, not a convention. |
| Large, must stay schematic | A saturating density field the eye cannot count, plus the number stated explicitly. Or a legend-backed unit ("each ▪ = 10"). |
| Any | Stating the number in text is *necessary but not sufficient* — the picture must not contradict it. |

**Bar length reads as linear.** Showing 1 vs 1,000 as 6% vs 100% understates by 60×; only acceptable in a degraded fallback where the true numbers are labelled.

### The decorative-override rule

A styling choice must never quietly destroy the informational claim. Real example: earlier stages were kept at `opacity: .05` "to imply accumulation" — with 1,000 additive points on a retina display that haze read as a thousand agents at the stage that was supposed to show **one**, killing the entire 10× story. Inactive data must go to `0`, not "faint".

Note the compounding factor: **point sizes scale with `devicePixelRatio`, opacity does not.** A bleed-through invisible at DPR 1 (your headless shot) is obvious at DPR 2 (the user's screen). Verify at DPR 2 when the medium allows.

### Evidence tiers

Every visual claim resolves to one of three tiers. State the tier; never leave it implied.

| Tier | Means | Example |
| --- | --- | --- |
| **Measured** | Read straight off the render — a computed style, a sampled pixel, a DOM measurement. Reproducible by rerunning the same instrument. | `scrollHeight = 2114px`, sampled `#1F1F1F` |
| **Derived** | Computed from measured values, not read directly. | "Four columns, evenly split across a 1200px container" |
| **Inferred** | A judgement call about cause or intent. Never stated as fact. | "Likely a `box-shadow` bleed, unconfirmed" |

An invented value presented as measured makes the whole answer worthless — it looks identical to the real thing until someone reruns the instrument and gets a different number. "Roughly 50px of blur, unmeasured" is a useful report; a `box-shadow` guessed because it looks plausible is not. When you cannot measure, say Inferred and stop there.

**A settled frame is what makes a reading Measured at all.** This is where the
tiers meet §3: an opacity read off a frame captured mid-tween is not a Measured
value, it is a Measured value *of the wrong thing*. So the tier of every reading
below depends on the capture strategy that produced the frame.

| Reading | Tier | What upgrades or breaks it |
| --- | --- | --- |
| `weakCues` from a single `checks.js` dump | **Measured** for that one state — it reports `scope: "single-sample"` for exactly this reason. | It cannot support the word *never*. A cue at 0.4 here may be at 1.0 two samples later, which is a healthy fade. |
| `weakCues` peak across a `converge.sh` run | **Measured**, and now the "never reaches 0.8" claim is legitimate: it is the max over every sampled frame. | Only as strong as the offsets you chose. A cue never sampled while on screen is absent from the number, not proven healthy. |
| A `deadScroll` pair | **Measured** — the two signatures are byte-identical, and rerunning gives the same answer. | Whether it is a **defect** is **Inferred**. A footer or a flow section holding still across two samples is a page behaving correctly. Triage each pair; never report the count alone as a bug count. |
| Any reading from a sample with `settled: false` | **Inferred at best.** | The frame is mid-flight. Re-run with a longer `--settle-timeout` before concluding anything from it. |
| A `deadScroll` count of 0 when `masking` is non-empty | **Not evidence.** | The check could not run. "Checked, nothing to do" and "could not check" must never be reported the same way. |

---

## 6. Layout traps that only appear at render time

| Trap | Mechanism | Check / fix |
| --- | --- | --- |
| **SVG text clipped** | `viewBox` clips its viewport. Text that starts inside can end far outside. | Estimate extent: monospace ≈ `chars × font-size × 0.6`. Assert `left + width ≤ viewBox width` for every `<text>`, honouring `text-anchor`. |
| **Anonymous grid item** | A bare text node directly inside `display:grid` gets wrapped in its own grid item and consumes the next track — so description text lands in a 14px marker column. | Wrap the text in a `<span>`. `<span class="m"></span><b>L</b>text` is **three** items, not two. |
| **Camera inside its own geometry** | A ring of radius R viewed from distance < R renders as straight lines crossing the frame, not a ring. | For vertical FOV θ, fitting radius R needs `d ≥ R / (fill × tan(θ/2))`. At θ=46°, `tan≈0.4245`, so `d ≈ 2.4R` to fit. |
| **Camera never positioned** | `new PerspectiveCamera()` sits at the origin — inside everything. `lookAt(0,0,0)` from the origin is degenerate. | Set position explicitly at construction; call `lookAt` every frame, not only inside a tween's `onUpdate`. |
| **Points invisible / wrong size** | `sizeAttenuation: true` makes size distance-derived and hard to predict. | Use `sizeAttenuation: false` and explicit pixel sizes, multiplied by `min(devicePixelRatio, 2)`, reapplied on resize. |
| **Two-column band looks broken** | One column has less content, so it ends early and leaves dead space. | Match column heights: shorten the tall element (a wide-short canvas beats a tall one) or add a real element to the short column. Never leave the imbalance. |
| **Count-up shows impossible values** | Tweening from the *previous* value passes through numbers the current label contradicts. | Always climb from a floor of 1 toward the target — never render 0, never overshoot the claim. |
| **Inline element ignores width/height** | A `<span>` inside a *non*-flex/grid parent stays `display:inline`, so `width`/`height` do nothing. Progress bars, meters and fills silently render at zero — every row looks identical and empty. | Blockify both the track and the fill (`display:block`). A parent being a grid/flex *item* blockifies it, but that does **not** propagate to its children. |
| **Sticky `<thead>` painted under the rows** | With `border-collapse: collapse` browsers paint cell backgrounds/borders in a way that ignores `z-index` on a sticky `<th>`, so scrolled rows appear *on top of* the header. | `border-collapse: separate; border-spacing: 0` (visually identical), plus `z-index` and an opaque `background` on `th` **and** on `tbody td`. |
| **Rows visible above a sticky header** | `position: sticky; top: 0` offsets from the scroll container's **padding** edge, so container `padding-top` leaves a live gap in which scrolled rows remain visible. | Put the top padding on the first child (`> *:first-child{margin-top:…}`), not on the scroll container. |
| **Wide table clips its right-hand columns** | `white-space: nowrap` on cells holding long identifiers (resource names, file paths) forces the table wider than its container; the last columns are cut off, not scrolled to. | Let those cells wrap (`white-space: normal; overflow-wrap: anywhere`). Reserve `nowrap` for genuinely short numeric cells. |
| **`overflow: hidden` eats the last child** | A flex column whose contents exceed its height silently clips the **final** element — usually the row of buttons or the CTA, i.e. the thing the reader most needs. Fits at your test size, clips at theirs. | Prefer `overflow-y: auto` so content is reachable rather than lost, and **probe at short viewport heights** (740–880px): an embedded artifact's iframe is far shorter than the window. |
| **Utility class corrupts a code value** | A helper carrying `text-transform: uppercase` (a severity/label class) applied to a cell containing code or config renders `const [message]` as `CONST [MESSAGE]`. | Scope the transform to label use only, e.g. `td.n.gt{text-transform:none}`. Never let a presentation class touch a verbatim value. |

---

## 7. Ship gates

Run all of these, then report. Cheap, and each has caught a real defect:

```bash
# tag balance
python3 - <<'PY'
import io,re
s=io.open('page.html',encoding='utf-8').read()
for t in ('div','span','svg','g','button','style','script','canvas'):
    o=len(re.findall(r'<%s[\s>]'%t,s)); c=len(re.findall(r'</%s>'%t,s))
    if o!=c: print('MISMATCH',t,o,c)
PY

# every inline script parses (modules need --input-type=module)
node --check /tmp/s0.js
node --input-type=module --check < /tmp/s1.js
```

Then: no dead CSS or JS referencing removed elements · `prefers-reduced-motion` honoured · a fallback exists for every external dependency.

**`fontload` is a required gate whenever a page declares a `@font-face`.** A missing or 404'd webfont does not fail loudly — the page falls back to a system stack and *still renders text*, so nothing in a screenshot or a validator flags it. Only `document.fonts.check()` distinguishes "the webfont actually applied" from "silently fell back." Set `window.__FONTS` to every declared shorthand and run `scripts/checks.js` (see [Matrix mode](#10-matrix-mode)) before reporting any page with a custom font as done:

```js
window.__FONTS = ['300 16px "Anton"', '700 14px "Inter"'];
```

A `loaded: false` here is a shipped defect even though the render "looks fine" — it means the typography in the render you just approved is not the typography that was specified.

**But do not report a partial count as a failure without confirming it.** `document.fonts.check()` also returns `false` for a declared face that is merely **`unloaded`** — i.e. that weight is not currently exercised by any rendered text. A page declaring 8 faces and using 4 will report `4/8` and be perfectly healthy. Distinguish the two before claiming a defect:

```js
// status per declared face: "loaded" | "unloaded" | "error"  — only "error" is a real failure
var faces = []; document.fonts.forEach(f => faces.push(f.family + '/' + f.weight + '/' + f.status));

// or force them and see which actually reject
Promise.all(WANT.map(w => document.fonts.load(w).then(f => f.length ? 'LOADED' : 'NO-FACE', () => 'ERROR')))
```

Fonts inlined as `data:` URIs cannot 404, so for a self-contained artifact a low `check()` count is almost always lazy activation, not breakage.

**Fallback watchdog.** A `type="module"` script that fails to import dies *silently* — no fallback runs, and the user sees a blank panel. Guard from a **classic** script, which still executes:

```html
<script>
addEventListener("load", function(){
  setTimeout(function(){
    var el = document.getElementById("stage");
    if (el && !el.dataset.booted) el.classList.add("no-render");  // reveal static fallback
  }, 3000);
});
</script>
```

Set `el.dataset.booted = '1'` as the first line of successful init. Test it by pointing the CDN URL at a dead host — do not assume it works.

---

## 8. Reporting

State what you rendered and looked at. Distinguish clearly between:

- **a real defect** you found and fixed
- **a measurement artifact** of the harness (the settle problem is always this)

Never present a validator pass as visual confirmation. If you could not render it, say so plainly and say what remains unverified — an honest gap beats a false "done".

---

## 9. Verification tiers

Not every change earns the full loop above. Pick the tier by what the render is *for*, and never report "done" below Standard.

| Tier | What you render | When it applies |
| --- | --- | --- |
| **Smoke** | One `render.sh shot`, one state, one theme. | While iterating — the fast build → look loop between edits. Proves nothing about the surface as a whole; do not cite it as verification. |
| **Standard** | The key states a reviewer will actually see, × both light and dark theme (`matrix.sh ... --themes light,dark --states <key-states>`). | Required before ANY done-claim. This is the floor for "I looked at it," not a ceiling — most work stops here. |
| **Flagship** | The full cartesian `matrix.sh` product (every theme × viewport × dpr you ship) + `contact-sheet.sh` to review it as one image + `baseline.sh diff` against an approved baseline. | Customer-facing, conference, or published work — anything that ships once, gets looked at by someone who cannot ask you to fix it live, and cannot be quietly patched after the fact. |

**An animated or scroll-driven surface has one extra floor.** On a page whose
content arrives over a timeline, a per-state screenshot only proves the states
you happened to freeze. Standard on such a page means a `converge.sh` run over
the offsets a reader actually passes through, with every sample `settled: true`.
A matrix of hash-jumped states is not a substitute: it never observes the page
travelling between them, which is where dead scroll and unfinished cues live.

A Standard pass that skips dark mode, or skips the states a reviewer will land on first, is not Standard — it is Smoke with extra steps. §7's ship gates (including `fontload`) apply at Standard and above; Flagship additionally requires an approved baseline to diff against (§10, `baseline.sh`).

---

## 10. Matrix mode

Five scripts turn "screenshot one thing" into "cover the surface": `matrix.sh` renders the cartesian product, `converge.sh` walks a timeline and shoots each settled position (§3), `contact-sheet.sh` makes either one reviewable as one image, `checks.js` gets machine-checked instead of eyeballed, `baseline.sh` turns "does this still look right" into a number.

### `scripts/matrix.sh` — render the cartesian product

```bash
scripts/matrix.sh page.html out/ \
  --themes light,dark,system \
  --viewports 1920x1080,1280x800,420x900 \
  --dpr 1,2 \
  --states "#slide-1,#slide-2"
```

- **Theme cells** (anything but `system`) are rendered from a **throwaway copy** of the page with a script appended that sets `document.documentElement.setAttribute('data-theme', <theme>)` — the source file is never touched, and the stamp is reapplied on a couple of short timers to beat a page's own localStorage/system-theme init from clobbering it. `system` renders the original page unmodified.
- **`--dpr`** maps straight to `--force-device-scale-factor`; verify it actually bit (`magick identify` the dpr2 PNG — it must be exactly 2× the dpr1 pixel dimensions) rather than assuming the flag landed.
- **`--states`** accepts a comma list. Each entry is EITHER a URL hash (`#slide-2`, appended straight to the cell's URL — this is the reliable path) OR a keypress script name. **Capability limit, not a bug:** `--screenshot` mode has no CDP/input session, so a keypress state is implemented as a best-effort injected `KeyboardEvent` dispatch — it fires page-level `addEventListener('keydown')` handlers, but reproduces no browser-default behavior (scrolling, focus movement, native controls). If a deck's slide advance depends on a real key event rather than a listener, use a hash-addressable state instead.
- Cells are named `<state>__<theme>__<WxH>__dpr<N>.png`. Every cell is printed to stdout as it's written and logged to `<outdir>/manifest.txt`.

### `scripts/contact-sheet.sh` — one image to read

```bash
scripts/contact-sheet.sh out/ out/contact-sheet.png --cols 4
```

Tiles every top-level `*.png` in a directory (matrix.sh's outdir works directly) into one labelled montage, downscaled shrink-only so the sheet's long edge stays ≤ 2200px — a sheet nobody can read at native resolution defeats the point. Handles 1 to 60+ cells.

### `scripts/checks.js` — programmatic checks, no eyes needed

Append the file's contents as a `<script>` before `</body>` in a throwaway copy (the same splice-a-copy idiom `render.sh`'s `with_probe()` uses — see §1), then read the result:

```bash
render.sh dump path/to/throwaway-copy.html
```

It writes one JSON blob to `document.title`:

| Check | Catches | Config |
| --- | --- | --- |
| `overflow` | Elements whose right edge exceeds `clientWidth` — the real bug class this exists for is horizontal page scroll (`pageScrollsX` is reported at the top level alongside the offender list). | none |
| `contrast` | Text/background pairs below WCAG 2.1 4.5:1 (3.0:1 for ≥24px, or ≥700-weight text ≥18.66px). | none |
| `weakCues` | Text whose **effective** opacity (its own × every ancestor's) sits under `0.8` **while under animation control** — an animated reveal left permanently semi-transparent. `contrast` structurally cannot see this: it computes the ratio of whatever opacity it finds and never asks whether an animation was supposed to finish. | `window.__CUES = ['.headline', ...]`, `window.__CUE_THRESHOLD` |

**`contrast` does not composite alpha, in either direction.** `nearestBg` returns the first
ancestor background with `a > 0` and uses its raw RGB; `relLuminance` ignores the text colour's
alpha too. So a **translucent tint** — `rgba(111,255,233,.12)` over a dark panel, which renders
as barely-tinted dark — is measured as **solid mint**, and near-white text on it reports a ratio
of `1.0`. That is a false positive, and it is easy to misread as "I shipped unreadable text".

Before believing a contrast failure, dump the pair the checker actually used:

```js
// walk exactly as the checker does, and print what it resolved
function nearestBg(el){ var n=el; while(n){ var bg=getComputedStyle(n).backgroundColor;
  var m=bg.match(/rgba?\(([^)]+)\)/); var p=m&&m[1].split(',').map(parseFloat);
  if(p && (p.length<4 || p[3]>0)) return {bg:bg, at:n}; n=n.parentElement; } return {bg:'white'}; }
```

If the resolved `bg` is an `rgba()` with low alpha, the finding is an artifact — the rendered
contrast is against whatever sits *beneath* the tint. Either verify by eye and note the exception,
or avoid translucent grounds behind text so the gate stays meaningful. Design-kit themes ship
`--*-accent-bg` tokens as low-alpha tints, so this fires on any panel filled with one.
| `missing` | Required selectors that match zero elements, or match elements collapsed to 0×0. | `window.__REQUIRE = ['.selector', ...]` |
| `fontload` | A declared `@font-face` that silently failed and fell back — **this is the only check that tells you the difference**; see §7. | `window.__FONTS = ['300 16px "Anton"', ...]` |

**`weakCues` only grades text whose opacity is under animation control**, and that
choice is the whole check. Flagging every element under the threshold is worse
than useless: a muted caption, a disabled control and a watermark are all
*deliberately* faint, and a check that fires on those trains you to ignore it.
So an element qualifies only when some animation or transition on it — or on an
ancestor whose opacity it composites with — actually keyframes `opacity`. Two
verified details make that reliable:

- **A completed CSS transition is removed from `getAnimations()` entirely.** Since this check reads the *settled* state by design, the live-animation evidence has already expired by the time it looks. The durable signal is the computed style, which still reports `transition-property: opacity` afterwards.
- **`transition-property` defaults to `all`**, so *every* element on the page reports `"all"` whether or not a transition is declared. Matching on the property list alone makes every text element a cue and the discriminator collapses. A non-zero `transition-duration` is required, paired to its own property.

**Limitation, not a bug:** a cue that was never triggered at all has no animation
to detect and reads as static text. Name those in `window.__CUES` — an author's
list beats any inference. Use `missing` for "should be there and isn't"; this
check is for "arrived, but never all the way".

Every list is capped at 12 entries with a total count, so the JSON survives a `<title>` round-trip. **`fontload` caveat, verified empirically:** `document.fonts.check()` returns `true` for a family name that has no `@font-face` rule at all — Chromium's font matcher reports the fallback as "available" rather than failing. It only returns `false` for a family that has a real `@font-face` whose resource failed to load. Only put families your page actually declares via `@font-face` into `__FONTS` — that is also the only case worth gating on.

**Gating a themed page (Standard tier, §9):** `checks.js` only sees whatever DOM it's spliced into — if Standard tier requires both themes, splice the theme stamp, the `__REQUIRE`/`__FONTS` globals, and `checks.js` into the *same* throwaway copy, then dump each themed copy separately. Exact commands (run once per theme; this is the verbatim pipeline, not a sketch):

```bash
cat > globals.js <<'JS'
window.__REQUIRE = ['.nav', '.cta-button']
window.__FONTS   = ['700 16px "Inter"']   # required by §7 whenever the page declares @font-face
JS

python3 - page.html page.dark.checked.html globals.js scripts/checks.js <<'PY'
import io, sys
src, dst, g, checks = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
s = io.open(src, encoding='utf-8', errors='replace').read()
stamp = "<script>document.documentElement.setAttribute('data-theme','dark')</script>"
gjs = io.open(g, encoding='utf-8').read()
cjs = io.open(checks, encoding='utf-8').read()
tag = stamp + '\n<script>\n%s\n</script>\n<script>\n%s\n</script>\n</body>' % (gjs, cjs)
s = s.replace('</body>', tag) if '</body>' in s else s + tag
io.open(dst, 'w', encoding='utf-8').write(s)
PY

scripts/render.sh dump page.dark.checked.html
```

Swap the `data-theme` value (or drop the `stamp` line for the default/system theme) and repeat per theme required by §9. A single unstamped dump only ever gates the default/system theme — it will miss a contrast or fontload failure that only manifests under a specific theme's CSS variables or webfont set.

### `scripts/converge.sh` — walk a timeline, shoot each settled position

```bash
scripts/converge.sh page.html out/ --offsets 0,700,1600,2600,3220 \
  --viewport 1280x800 --ignore-motion '#scroll-progress' --cues '.headline'
```

The strategy, the bucket table and the traps are in §3. What it writes: one
`s<NN>__y<NNNNN>.png` per offset (so the sheet reads in scroll order),
`manifest.txt`, and `report.json` carrying every sample's buckets, cue readings
and animation phases. `contact-sheet.sh` and `baseline.sh` both glob top-level
`*.png` only, so they consume this directory unchanged.

It needs `node >= 22` — it drives Chrome over the DevTools protocol using node's
built-in `WebSocket`, adding no npm dependency. `--screenshot` cannot express
"shoot now, I have decided the page is ready", which is the entire job.

Two multi-sample checks live in `converge-driver.mjs`, **not** in `checks.js`,
because that file is injected into one DOM at one instant and these are
statements about the relationship *between* samples:

| Check | Catches | Note |
| --- | --- | --- |
| `deadScroll` | Consecutive samples whose visible state is identical across a large scroll delta — the reader scrolled a viewport and was shown nothing new. | Compares **actual** scroll position, since an offset past the document end clamps silently. Its signature holds cue opacities, scroll-deterministic animation playheads, computed transforms, paused media times, **and a fingerprint of the on-screen text and where it sits**. |
| `weakCuesPeak` | The max of `checks.js`'s per-sample `weakCues` across the run — the claim "this cue never reaches 0.8 anywhere", which one sample cannot make. | Tune with `--cue-threshold`. |

### `scripts/baseline.sh` — regression diff

```bash
scripts/baseline.sh approve out/          # first pass: bless the current cells
scripts/baseline.sh diff out/             # later: compare against the blessed set
scripts/baseline.sh diff out/ --tolerance 50
```

`approve` copies `out/`'s top-level `*.png` cells into `out/_approved/`. `diff` compares each current cell against its approved twin with ImageMagick `compare -metric AE` and prints one line per cell:

| Line | Meaning |
| --- | --- |
| `NEW <name>` | No baseline exists yet. Not a failure — a matrix that grew a state/theme/viewport isn't a regression by itself. |
| `DIMS <name>` | Baseline exists at a different pixel size. **Is** a failure. Checked explicitly before diffing — `compare` does not error on a size mismatch, it silently rescales one image onto the other's canvas and reports a distorted, meaningless count, so a viewport/dpr change must never be laundered through that path. |
| `<N> <name>` | AE pixel-diff count. Exits nonzero if any cell exceeds `--tolerance` (default `0`: exact match required). |
