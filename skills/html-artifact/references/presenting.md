# Presenting — speaker notes, full screen, and the sandbox

An artifact renders inside a **sandboxed iframe**. Two presenter features people
expect can be blocked by that sandbox, and both fail in ways that look like your
bug rather than a permission:

| Feature | Needs | If blocked |
| --- | --- | --- |
| `window.open` — notes on a second screen | `allow-popups` | returns `null` |
| `requestFullscreen()` | `allow-fullscreen` | rejects, or the method is absent |

**Never assume either works. Always ship a fallback**, and make the fallback
good enough that a blocked permission is a downgrade, not a failure.

## Speaker notes

Notes live on the slide, so they travel with the markup and cannot drift:

```html
<section class="slide" data-t="Architecture — before"
         data-notes="Point at the email path — STid never sends the invitation…">
```

`S` toggles. Try a real popout window first; fall back to an in-page overlay.

```js
var nWin = null;
function openNotesWin(){
  var w = null;
  try { w = window.open('', 'deck-notes', 'width=560,height=720'); } catch(e){}
  if (!w) return false;                       // popups blocked
  nWin = w;
  try {
    w.document.write('<!doctype html><meta charset="utf-8"><title>Speaker notes</title>'
      + '<style>/* self-contained — the popup inherits nothing */</style>'
      + '<h1>Slide <span id="n"></span></h1><p id="t"></p><p id="b"></p><p id="x"></p>');
    w.document.close();
  } catch(e){ nWin = null; return false; }
  return true;
}
function toggleNotes(){
  if (nWin && !nWin.closed){ try{ nWin.close(); }catch(e){} nWin = null; return; }
  if (!openNotesWin()) overlay.hidden = false;   // graceful downgrade
  paintNotes();
}
```

Three things that matter:

- **The popup inherits nothing** — not your CSS, not your tokens. Write a
  complete self-contained document into it, or you get unstyled text on white.
- **Repaint on every navigation**, not just on open. Wrap the writes in
  `try/catch`: the presenter can close that window at any moment and a throw
  there would break slide navigation itself.
- **Show the next slide's title** in the notes window. It is the single most
  useful thing a presenter view provides.

The in-page overlay should dock above the nav bar with `max-height:44vh` and its
own scroll — notes are prose and will overflow on a laptop.

## Full screen

```js
function toggleFS(){
  var d = document, el = d.documentElement;
  if (d.fullscreenElement){ d.exitFullscreen && d.exitFullscreen(); return; }
  var req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req){
    try {
      var r = req.call(el);
      if (r && r.catch) r.catch(function(){ document.body.classList.toggle('zen'); });
      return;
    } catch(e){}
  }
  document.body.classList.toggle('zen');       // blocked → zen mode
}
```

`requestFullscreen` can fail **three** ways: absent, throwing synchronously, or
returning a promise that rejects. Handle all three — the promise rejection is
the one that gets missed, and it is the common case inside an iframe.

**Zen mode** is the fallback and is genuinely useful on its own — hide the
chrome, give the slide the full viewport:

```css
body.zen .bar, body.zen .prog{display:none}
body.zen .slide{height:100vh;padding-bottom:clamp(48px,5vw,64px)}
```

Bind `Escape` to leave zen. Users expect Escape to exit *something* full-screen-ish
and will press it whether or not the API engaged.

## Keyboard map

Keep it small and conventional:

| Key | Action |
| --- | --- |
| `→` `space` `PageDown` | next |
| `←` `PageUp` | previous |
| `Home` / `End` | first / last |
| `S` | speaker notes |
| `F` | full screen |
| `Escape` | leave zen · close index · close notes |

Guard against hijacking real typing:

```js
if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
```

Single letters are safe here because artifacts rarely contain text inputs — but
add the guard anyway; the day someone drops a filter box in, `F` would stop
being typable.

## Rehearsal checklist

- Press `S`. Notes appear — window if allowed, overlay if not. **Both paths work.**
- Navigate with the notes open; they follow, and the next-slide line is right.
- Close the notes window manually, then navigate. Nothing throws.
- Press `F`. Full screen or zen. `Escape` leaves.
- Print to PDF: chrome and notes hidden, every slide on its own page.
- Present from a laptop at 1024×768. Slides that fit at 1440 often do not.
