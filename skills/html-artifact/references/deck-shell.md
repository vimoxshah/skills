# Deck shell — paging, nav, and deep-dive tabs

## Slide mechanics

```css
.slide{display:none; height:100dvh; overflow-y:auto;
       padding: clamp(48px,5vw,64px) clamp(22px,5vw,84px) 92px;
       -webkit-overflow-scrolling:touch}
.slide.on{display:block}
```

**`height`, not `min-height`.** With `min-height` the slide grows and the *body*
scrolls — paging breaks, the fixed bar overlaps content, and `scrollTo(0,0)`
lands in the wrong place. A fixed height makes each slide its own scroll
container, which is what a deck needs on a short laptop screen.

Bottom padding must clear the fixed nav bar.

## Navigation

Ship all four: keyboard, buttons, hash deep-links, progress.

```js
function show(n, push){
  i = Math.max(0, Math.min(total-1, n));
  slides.forEach((s,k)=> s.classList.toggle('on', k===i));
  slides[i].scrollTop = 0; window.scrollTo(0,0);
  prog.style.width = ((i+1)/total*100) + '%';
  title.textContent = slides[i].dataset.t || '';
  cnt.textContent = (i+1) + ' / ' + total;
  prev.disabled = i===0; next.disabled = i===total-1;
  if (push) history.replaceState(null,'','#'+(i+1));
}
document.addEventListener('keydown', e => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;   // don't hijack typing
  if (e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){ e.preventDefault(); show(i+1,true); }
  else if (e.key==='ArrowLeft'||e.key==='PageUp'){ e.preventDefault(); show(i-1,true); }
  else if (e.key==='Home'){ e.preventDefault(); show(0,true); }
  else if (e.key==='End'){ e.preventDefault(); show(total-1,true); }
});
window.addEventListener('hashchange', ()=>{
  const n = parseInt(location.hash.slice(1),10); if(!isNaN(n)) show(n-1,false);
});
```

`data-t="…"` on each slide gives the nav bar a title and makes the deck
navigable by section rather than by number. Hash deep-links (`#7`) let someone
jump straight to a slide mid-meeting — cheap, and the thing people actually
ask for.

`history.replaceState` not `pushState`: arrow-keying through 14 slides should
not bury the back button.

## Deep-dive tabs

One deck, two audiences. The slide carries the argument; tabbed panels beneath
carry the evidence. Collapsed by default so the skim path stays intact.

```html
<div class="dive">
  <div class="dive-tabs" role="tablist" aria-label="Deep dive">
    <button class="dive-tab" role="tab" aria-selected="false"
            aria-controls="d1p1" id="d1t1">Payloads</button>
    <button class="dive-tab" role="tab" aria-selected="false"
            aria-controls="d1p2" id="d1t2">Call sites</button>
  </div>
  <div class="dive-panel" role="tabpanel" id="d1p1" aria-labelledby="d1t1" hidden>…</div>
  <div class="dive-panel" role="tabpanel" id="d1p2" aria-labelledby="d1t2" hidden>…</div>
</div>
```

```js
document.querySelectorAll('.dive').forEach(d => {
  const tabs = [...d.querySelectorAll('.dive-tab')];
  const pans = [...d.querySelectorAll('.dive-panel')];
  tabs.forEach((t,k)=> t.addEventListener('click', ()=>{
    const open = t.getAttribute('aria-selected')==='true';   // click again to close
    tabs.forEach(x=>x.setAttribute('aria-selected','false'));
    pans.forEach(p=>p.hidden = true);
    if (!open){ t.setAttribute('aria-selected','true'); pans[k].hidden = false; }
  }));
  // ←/→ move slides, so tabs use ↑/↓ to avoid fighting the deck
  d.addEventListener('keydown', e => {
    const at = tabs.indexOf(document.activeElement); if (at < 0) return;
    if (e.key==='ArrowDown'){ e.preventDefault(); tabs[(at+1)%tabs.length].focus(); }
    if (e.key==='ArrowUp'){ e.preventDefault(); tabs[(at-1+tabs.length)%tabs.length].focus(); }
  });
});
```

**The keyboard conflict is the part that gets missed.** A deck already owns
←/→ for paging, so a tablist using the WAI-ARIA default (←/→ between tabs)
would trap the user. Move tab traversal to ↑/↓ and let ←/→ keep paging. Tabs
stay reachable by Tab and operable by Enter/Space, so nothing is lost.

**Click-again-to-close** matters: a reader who opened a panel to check one
number wants the slide back, not a second click hunting a close button.

### What belongs in a dive panel

Payload diffs · SQL · `file:line` citations · a derivation · a full table the
slide summarises · the exact wording of an external request.

**Not** overflow prose. If the slide needs a dive to make sense, the slide is
wrong. Test: hide every panel — does the deck still carry its argument?

### Inline panels vs a full-screen sheet

An **inline** panel is bounded by whatever slide height is left over, so a dive
containing a real table or a code block clips, scrolls in a 4-line window, or
shoves the takeaway off the slide. If your dives carry tables, diffs or more
than a short paragraph, put the content in a **full-screen sheet** instead:

- Tab row stays on the slide; clicking opens a sheet at `height: min(92vh, 100%)`.
- Put **every tab for that slide inside the sheet header**, so a reader can walk
  the dives without closing and reopening.
- Keep the panel bodies as hidden `.dd-src` divs in the slide and clone
  `innerHTML` into the sheet — the content stays authored inline, next to the
  slide it belongs to, and stays greppable.
- Route the open through one function that takes the *tab container* explicitly
  (`openDive(tabsEl, srcId, ctxLabel)`), not `slide.querySelectorAll('.tabs button')`.
  The moment a second thing on the slide opens dives — a clickable step, a phase
  box — the implicit lookup grabs the wrong buttons.

**Any element on a slide can open a dive.** Numbered step boxes, phase chips and
timeline nodes make excellent dive triggers: the reader clicks the thing they are
already looking at. Make them real `<button>`s, give them a visible affordance
(`details ↗`), and label them for screen readers.

### Two failures that only appear on someone else's screen

**Renumber slides from DOM order, never from an assumed sequence.** Inserting a
slide and then rewriting `data-slide="10"` → `"11"` hits whichever occurrence
comes first in the document — which may be the slide you just inserted. Derive
the numbers instead:

```js
document.querySelectorAll('.slide').forEach((s, i) => s.dataset.slide = i + 1);
```

**Never re-animate the incoming slide's children during a transition.** Running
`fromTo(kids, {opacity: 0})` part-way through a page turn makes the content
blank and re-fade *after* the slide is already visible — it reads as a flicker,
and it is the single most common complaint about deck motion. Paint the incoming
content **before** the transition starts, and animate only the slide container.
Regression check: mid-transition, no child may sit below full opacity.

## Layout furniture

```css
.prog{position:fixed;left:0;top:0;height:3px;background:var(--accent);z-index:50;
      transition:width .35s cubic-bezier(.3,.8,.3,1)}
.bar{position:fixed;left:0;right:0;bottom:0;height:56px;background:var(--raise);
     border-top:1px solid var(--rule);display:flex;align-items:center;gap:14px;z-index:40}
```

Keep the bar quiet — a progress line, prev/next, the section title, `n / total`.
A deck's chrome should disappear; if the reader notices your nav, it is loud.
