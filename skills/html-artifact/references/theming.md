# Theming — what we support, and giving the reader control

## What an artifact actually supports

Three inputs decide the palette, in increasing priority:

1. **The viewer's OS** — `prefers-color-scheme`.
2. **The host's theme toggle** — claude.ai stamps `data-theme="dark"|"light"`
   on `:root`.
3. **Your in-page control** — writes the same attribute.

(2) and (3) both write `document.documentElement.dataset.theme`, so they
cooperate rather than fight: last write wins, and the reader always sees the
switch they just used. That is why the base pattern must be attribute-driven —
`references/design-system.md` has the three-layer token block, and everything
here builds on it.

## Should the page ship its own toggle?

**Yes, when the artifact is a deliverable someone will present or return to** —
a deck shown on a projector, a report read over days. The host toggle lives in
the surrounding UI, is easy to miss, and disappears entirely if the page is
opened full-screen.

**No, for a short read.** A control with no purpose is clutter.

## Tri-state toggle: system → light → dark

Respecting "system" matters. A binary toggle strands a reader whose OS switches
at sunset on whatever they last picked.

```html
<button class="theme-btn" id="theme" aria-label="Theme: follow system">
  <span aria-hidden="true" id="theme-icon">◐</span>
</button>
```

```js
(function(){
  var root = document.documentElement, btn = document.getElementById('theme'),
      icon = document.getElementById('theme-icon');
  var modes = ['system','light','dark'], glyph = {system:'◐',light:'○',dark:'●'};
  var mode = 'system';
  try { mode = localStorage.getItem('theme') || 'system'; } catch(e){}

  function apply(){
    if (mode === 'system') root.removeAttribute('data-theme');   // hand back to OS + host
    else root.setAttribute('data-theme', mode);
    icon.textContent = glyph[mode];
    btn.setAttribute('aria-label', 'Theme: ' + (mode === 'system' ? 'follow system' : mode));
    try { localStorage.setItem('theme', mode); } catch(e){}
  }
  btn.addEventListener('click', function(){
    mode = modes[(modes.indexOf(mode) + 1) % modes.length]; apply();
  });
  apply();
})();
```

Two details that get missed:

- **`removeAttribute` on system**, not `data-theme="system"`. Removing it lets
  the media query take over again; an unknown attribute value leaves the page
  stuck on the light base layer.
- **`try/catch` around `localStorage`.** It throws in some privacy modes, and an
  uncaught error there kills every script that follows.

```css
.theme-btn{font-family:var(--mono);font-size:14px;line-height:1;cursor:pointer;
           background:none;color:var(--ink-faint);border:1px solid var(--rule);
           padding:7px 10px}
.theme-btn:hover{color:var(--accent);border-color:var(--accent)}
```

Put it in the deck's nav bar or a page's header — same rail as the other
furniture, never floating over content.

## Beyond light and dark

Tokens make additional palettes nearly free. Useful when a deck is presented in
different rooms:

```css
:root[data-theme="high-contrast"]{
  --ground:#000; --ink:#fff; --rule:#fff;
  --accent:#4DE8DC; --accent-bg:#00312D;
}
:root[data-theme="print"]{           /* projector-safe / handout */
  --ground:#fff; --ink:#000; --rule:#999;
  --accent:#005C56; --accent-bg:#E6F2F1;
}
```

Add them to the `modes` array. **Do not ship a palette picker with six options**
— a deck is not a theme demo. Two or three, each with a reason.

A page may also deliberately commit to a single visual world (a terminal, a
letterpress invitation). That is a legitimate choice — make it explicit in the
design plan rather than an omission, and skip the toggle entirely.

## Print

Nearly-free win for anyone who exports the deck to PDF:

```css
@media print{
  :root{--ground:#fff;--raise:#fff;--ink:#000;--ink-soft:#333;--rule:#999}
  .slide{display:block !important;height:auto;page-break-after:always}
  .bar,.prog,.theme-btn,.dive-tabs{display:none}
  .dive-panel{display:block !important}   /* dives print expanded — the handout wants the depth */
  a::after{content:" (" attr(href) ")";font-size:11px;color:#555}
}
```

Every slide prints, deep-dive panels print open, chrome disappears, and links
show their targets on paper.

## Checks

- Toggle through every mode. Contrast legible in all; accent readable on both grounds.
- Reload after switching — the choice persists.
- Set the OS to the opposite of your last pick, choose "system", confirm it follows.
- Never hardcode a hex outside the token block. One stray `#fff` is invisible in
  light mode and glaring in dark.
