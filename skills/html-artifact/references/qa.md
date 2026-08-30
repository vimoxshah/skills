# QA — validate before publishing

Publishing puts the page at a URL someone else opens. These are the failures
that survive reading your own markup, ordered by how often they actually bite.

**Two halves.** The structural script below is this skill's own (CSP, size,
theme-block correctness — things unique to a published artifact). Everything that
requires *rendering* is delegated to `visual-verify`, which owns the browser and
the tiers — don't re-implement a screenshot recipe here.

```bash
SKILLS=${SKILLS:-$(ls -d ~/.claude/skills ~/.agents/skills ~/.cursor/skills 2>/dev/null | head -1)}
vv=$SKILLS/visual-verify/scripts
# An artifact is the dual-theme surface matrix mode exists for. Render every
# theme state the viewer can actually be in — system-default, forced dark,
# forced light — plus a phone width, then read ONE contact sheet.
"$vv/matrix.sh" "file://$PWD/page.html" /tmp/art \
    --themes system,dark,light --viewports 1280x900,420x900
"$vv/contact-sheet.sh" /tmp/art /tmp/art-sheet.png

# Programmatic checks that need no eyes: overflow, contrast, required elements,
# and fontload. Append checks.js to a THROWAWAY copy, never the real file.
cp page.html /tmp/probe.html
{ echo '<script>'; cat "$vv/checks.js"; echo '</script>'; } >> /tmp/probe.html
"$vv/render.sh" dump "file:///tmp/probe.html" | grep -o '<title>[^<]*'
```

Tier by stakes: **smoke** (one shot) while iterating · **standard** (both themes,
key states) before any done-claim · **flagship** (full matrix + contact sheet +
`baseline.sh` diff) for anything published or customer-facing.

**`fontload` is required for any page that inlines a face.** CSP blocks font CDNs
*silently* and a data-URI face can fail just as quietly — the page then renders in
a system stack and looks entirely plausible. Emit the assertion list with
`design-kit`'s `dk.py assert-fonts <theme> <pairing> --surface artifact` and let
the check turn it into a pass/fail. Two things to know before you trust a `false`:
it also reports false for a declared weight the page never actually renders (lazy
loading, not a bug), and it reports *true* for a family you never declared at all
(fallback match) — so pair it with a computed `font-family` readback on a real
heading. Details in `design-kit/references/fonts.md`.

## Run this

```bash
python3 - "$FILE" <<'PY'
import re,sys
s=open(sys.argv[1]).read()
fail=[]
def chk(c,m): (fail.append(m) if not c else None)

print('size: %d KB' % (len(s)//1024))
chk(len(s) < 16*1024*1024, 'over the 16 MB page limit')

# CSP blocks resource LOADS. <a href="https://…"> navigation links are fine.
res = re.findall(r'\bsrc=["\']https?://', s) + re.findall(r'<link[^>]+href=["\']https?://', s)
chk(not res, 'external resource load(s) — blocked by CSP: %d' % len(res))
for a in re.findall(r'<a [^>]*target="_blank"[^>]*>', s):
    chk('noopener' in a, 'target="_blank" without rel="noopener noreferrer"')
chk('@import' not in s, '@import will fail under CSP')
chk('fetch(' not in s or 'window.claude' in s, 'fetch() without a declared capability')

for t in ['section','figure','svg','table','div','g','text','ol','ul','tbody','details']:
    o=len(re.findall(r'<%s[\s>]'%t,s)); c=s.count('</%s>'%t)
    chk(o==c, '%s: %d open / %d close' % (t,o,c))

ids  = set(re.findall(r'<marker id="([^"]+)"', s))
used = set(re.findall(r'url\(#([^)]+)\)', s))
chk(not (used-ids), 'undefined marker refs: %s' % sorted(used-ids))
allids = re.findall(r'\sid="([^"]+)"', s)
dupes  = {x for x in allids if allids.count(x) > 1}
chk(not dupes, 'duplicate ids (SVG defs collide silently): %s' % sorted(dupes))

svg = s.count('role="img"'); cap = s.count('<figcaption')
chk(s.count('<svg') == svg, '%d svg but %d role="img"' % (s.count('<svg'), svg))
chk(s.count('<figure') == cap, '%d figure but %d figcaption' % (s.count('<figure'), cap))

# SVG text wider than its box — silent, ships past review
for si,svg in enumerate(re.findall(r'<svg\b.*?</svg>', s, re.S), 1):
    rects=[tuple(map(float,m.groups())) for m in
           re.finditer(r'<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"', svg)]
    for m in re.finditer(r'<text x="([\d.]+)" y="([\d.]+)"[^>]*?font-size="([\d.]+)"'
                         r'[^>]*?text-anchor="middle"[^>]*?>(.*?)</text>', svg, re.S):
        x,y,fs = float(m.group(1)),float(m.group(2)),float(m.group(3))
        txt = re.sub(r'<[^>]+>','',m.group(4)); w = len(txt)*fs*0.6
        for rx,ry,rw,rh in rects:
            if rx<=x<=rx+rw and ry<=y<=ry+rh:
                chk(w <= rw-10, 'svg#%d text overflows its rect: "%s" ~%.0fpx in %.0fpx' % (si,txt[:44],w,rw))
                break

chk('prefers-reduced-motion' in s or '@keyframes' not in s, 'animations with no reduced-motion rule')
chk('data-theme="dark"' in s or ':root[data-theme' in s, 'no data-theme override — viewer toggle will not work')
chk('<title>' in s, 'no <title>')
for bad in ['<!doctype','<html','<head>','<body>']:
    chk(bad not in s.lower(), 'remove %s — the wrapper supplies it' % bad)

print('\n'.join('FAIL: '+f for f in fail) if fail else 'PASS')
PY
```

## What each check is protecting against

**External resources.** Fail *silently* — a blocked font falls back and the page
just looks slightly wrong. Nothing in the console tells the viewer.

**But outbound `<a href>` links are fine and often wanted.** The CSP restricts what
the page *loads*, not where it *navigates*. An artifact that summarises a body of
work should link to it — a repo folder, a ticket, a doc set. Check the pattern,
not the protocol: flag `src=` and `<link href=`, never `<a href=`. Add
`target="_blank" rel="noopener noreferrer"` on outbound links.

**Tag balance.** An unclosed `<div>` in the middle of a deck swallows every
following slide into the current one. Browsers repair it inconsistently, so it
can look fine locally and break for the reader.

**Duplicate ids / undefined markers.** Several diagrams on one page each
defining `id="arrow"` means every arrowhead silently takes the first
definition's colour. This is the single most common SVG bug on multi-figure
pages, and it looks like a styling mistake rather than a collision.

**`role="img"` and `figcaption` counts.** Cheap proxy for "every figure is
accessible and captioned". A caption also forces you to state the claim, which
often reveals the diagram is not making one.

**SVG text overflow.** SVG neither wraps text nor warns you. A label wider than
its `<rect>` draws straight over the neighbouring element and looks identical at
every zoom, so it survives review and ships. The heuristic here
(`chars × font-size × 0.6` for a monospace face) is approximate but catches the
real cases — it found three in a deck that had already been reviewed by eye.

**`data-theme` override.** Without the explicit `[data-theme]` layers, the
viewer's in-page toggle does nothing — the page is stuck on their OS setting.
Trivially reproducible, and constantly shipped broken.

**Document wrapper tags.** The publish step injects `<!doctype>…<body>`. Your
own copies produce nested documents.

## Then look at it

The script cannot see these:

- **Both themes.** Toggle. Check the accent still reads on the other ground and
  that no text has dropped to near-invisible contrast.
- **Narrow viewport.** Diagrams should scroll, not shrink. Nothing should cause
  horizontal scroll on `<body>` itself.
- **Keyboard alone.** Tab through: visible focus everywhere, no trap, and in a
  deck confirm ←/→ still page while tab controls are reachable.
- **Reduced motion on.** Content must be fully visible — not stuck at an
  animation's start state.
- **Return to a slide.** Entry animations should replay, not sit half-applied.

## After publishing — verify the page, not the call

**The publish tool returns the same URL whether or not your content changed.** A
successful publish and a silent no-op are indistinguishable from the tool result.
If you say "it's live" on that basis, you are guessing.

Fetch the published page back and check for a string only the new version has:

```
WebFetch(url, "Report present/absent: <a distinctive string from the change>")
```

Then grep the fetched copy for the specific things you added:

```python
for name, pat in [('theme toggle', r'id="theme"'),
                  ('print styles',  r'@media print'),
                  ('new slide',     r'What we are actually migrating')]:
    print(('LIVE ' if re.search(pat, s) else 'MISSING '), name)
```

Do this whenever the user asks "did that get applied?" — and by default after any
publish that followed a non-trivial edit. It costs one call and it is the only
way to know.

If the page is stale in a browser but current in the fetch, it is a client cache:
a hard reload clears it.

## Content honesty

The check that matters most and no script performs: **every number on the page
came from something you ran.** A shared artifact outlives the conversation that
produced it, and a figure nobody can trace becomes fact by repetition.

If a claim is inferred rather than measured, say so on the page — a chip, a
footnote, a "pending verification" marker. Confident wrong numbers are worse
than visible gaps.
