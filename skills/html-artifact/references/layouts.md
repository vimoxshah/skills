# Layouts — tabs, sidebar, split view, SPA routing

Four shells cover almost everything. Pick by how the reader moves through the
content, not by what looks impressive.

| Reader behaviour | Shell |
| --- | --- |
| Linear, presented, one idea per screen | **Deck** — `deck-shell.md` |
| Parallel alternatives at the same level | **Tabs** |
| Many sections, non-linear, needs orientation | **Sidebar + content** |
| Comparing two things continuously | **Split view** |
| Distinct destinations, deep-linkable | **SPA routing** (below; often + sidebar) |

## Tabs

For genuinely parallel content — three options, four environments, before/after.
Not for sequence (use a deck) and not for depth (use the dive pattern).

```html
<div class="tabs" role="tablist" aria-label="Environments">
  <button role="tab" aria-selected="true"  aria-controls="p1" id="t1">Staging</button>
  <button role="tab" aria-selected="false" aria-controls="p2" id="t2" tabindex="-1">Production</button>
</div>
<div role="tabpanel" id="p1" aria-labelledby="t1">…</div>
<div role="tabpanel" id="p2" aria-labelledby="t2" hidden>…</div>
```

```js
function wireTabs(root, horizontal = true){
  const tabs = [...root.querySelectorAll('[role=tab]')];
  const pans = tabs.map(t => document.getElementById(t.getAttribute('aria-controls')));
  const sel = k => {
    tabs.forEach((t,j) => { t.setAttribute('aria-selected', String(j===k)); t.tabIndex = j===k?0:-1; });
    pans.forEach((p,j) => p.hidden = j!==k);
  };
  tabs.forEach((t,k) => t.addEventListener('click', () => sel(k)));
  root.addEventListener('keydown', e => {
    const at = tabs.indexOf(document.activeElement); if (at < 0) return;
    const [prev,next] = horizontal ? ['ArrowLeft','ArrowRight'] : ['ArrowUp','ArrowDown'];
    if (e.key===next){ e.preventDefault(); tabs[(at+1)%tabs.length].focus(); }
    if (e.key===prev){ e.preventDefault(); tabs[(at-1+tabs.length)%tabs.length].focus(); }
  });
  sel(0);
}
```

**Roving tabindex** — only the selected tab is `tabindex="0"`. Without it, Tab
walks through every tab before reaching content, which is the standard mistake.

**Inside a deck, pass `horizontal=false`.** ←/→ already page the deck; a
horizontal tablist would trap the reader.

## Sidebar

Once a page has more than ~6 sections, readers need to see the shape of the
whole thing. A sidebar is orientation, not decoration.

```css
.shell{display:grid;grid-template-columns:250px 1fr;min-height:100dvh}
.side{position:sticky;top:0;height:100dvh;overflow-y:auto;
      border-right:1px solid var(--rule);background:var(--raise);padding:26px 0}
.side a{display:block;padding:8px 24px;color:var(--ink-soft);text-decoration:none;
        border-left:2px solid transparent;font-size:14px}
.side a:hover{color:var(--ink);background:var(--ground)}
.side a[aria-current="true"]{color:var(--accent);border-left-color:var(--accent);
                             background:var(--accent-bg)}
@media(max-width:860px){
  .shell{grid-template-columns:1fr}
  .side{position:fixed;inset:0 auto 0 0;width:270px;z-index:60;
        transform:translateX(-100%);transition:transform .28s ease}
  .side.open{transform:none}
  .scrim{position:fixed;inset:0;background:#0008;z-index:55;display:none}
  .scrim.on{display:block}
}
```

Below 860px it becomes a drawer. Ship the scrim, close on `Escape`, close on
scrim click, and return focus to the toggle — a drawer that traps focus is worse
than no drawer.

**Scroll-spy** — mark the section the reader is actually in:

```js
const links = [...document.querySelectorAll('.side a')];
const spy = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  links.forEach(a => a.setAttribute('aria-current',
    String(a.getAttribute('href') === '#' + e.target.id)));
}), { rootMargin: '-45% 0px -50% 0px' });
document.querySelectorAll('section[id]').forEach(s => spy.observe(s));
```

The asymmetric `rootMargin` creates a thin band across the middle of the
viewport, so exactly one section is ever current. Equal margins make the
highlight flicker between two.

Add `html{scroll-behavior:smooth}` — but wrap it in the reduced-motion guard.

## Split view

For continuous comparison — before/after, config vs result, two candidates.

```css
.split{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--rule);
       border:1px solid var(--rule)}
.split > *{background:var(--ground);padding:22px;min-width:0}   /* min-width:0 stops overflow */
@media(max-width:760px){.split{grid-template-columns:1fr}}
```

`min-width:0` on grid children is the fix for "my code block stretched the
column" — grid items default to `min-width:auto` and refuse to shrink below
content width.

For a draggable comparison slider, one `<input type="range">` driving a
`clip-path` beats any library:

```js
range.addEventListener('input', e =>
  after.style.clipPath = `inset(0 0 0 ${e.target.value}%)`);
```

## SPA routing

When the page has real destinations someone links to or bookmarks.

```js
const views = [...document.querySelectorAll('[data-view]')];
function route(){
  const id = (location.hash.slice(1) || views[0].dataset.view);
  views.forEach(v => v.hidden = v.dataset.view !== id);
  document.querySelectorAll('[data-nav]').forEach(a =>
    a.setAttribute('aria-current', String(a.dataset.nav === id)));
  document.title = `${document.querySelector(`[data-view="${id}"]`)?.dataset.title ?? ''} — Deck`;
  window.scrollTo(0,0);
  document.querySelector(`[data-view="${id}"]`)?.focus();   // move focus for screen readers
}
addEventListener('hashchange', route); route();
```

**Hash routing, not History API.** Artifacts are served under a path you do not
control; `pushState` to `/settings` produces a URL that 404s on refresh. Hash
routes always survive a reload and a paste into Slack.

Move focus to the new view on navigation. Without it, a screen-reader user
navigates and hears nothing change.

## Responsive

Use container-relative sizing (`clamp()`, `minmax()`, `auto-fit`) so layouts
adapt without a breakpoint per component. Reserve media queries for genuine
structural change — sidebar becoming a drawer, split becoming stacked.

Test three widths: ~1440 (laptop), ~1024 (projector), ~390 (phone). A deck
presented from a MacBook to a 16:9 projector is the common real case, and it is
shorter than you designed for.
