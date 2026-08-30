# QA gate — run before calling a deck done

## Structural checks (deterministic — run all)

```bash
D="$DECKS_DIR/<Deck Name>"; H="$D/<Deck Name>.html"
# 1. slide count == speaker-notes count
python3 - "$H" <<'EOF'
import json,re,sys
t=open(sys.argv[1]).read()
slides=len(re.findall(r'<section class="slide',t))
m=re.search(r'id="speaker-notes">\s*(\[.*?\])\s*</script>',t,re.S)
notes=len(json.loads(m.group(1))) if m else 0
print(f"slides={slides} notes={notes}", "OK" if slides==notes else "MISMATCH — fix notes array")
EOF
# 2. every section has a data-label
grep -c '<section class="slide' "$H"; grep -c 'data-label=' "$H"   # must match
# 3. no raw hex colors in slide content (tokens only; style block is exempt)
sed -n '/<deck-stage/,/SLIDES-END/p' "$H" | grep -oE '#[0-9a-fA-F]{6}' | head   # expect empty
# 4. asset links resolve (deck-stage.js, deck-anim.js, css, logo, fonts)
grep -oE '(src|href)="[^"#][^":]*"' "$H" | grep -v http | cut -d'"' -f2 | while read f; do [ -f "$D/$f" ] || echo "MISSING: $f"; done
# 5. print variant exists and is fresh (regenerate after any edit)
ls -la "$D/"*-print.html
# 6. if a design-kit theme is used: THEME_KEY entry AND TWEAK_DEFAULTS must agree.
#    The panel overwrites <html data-theme> on mount, so a missing TWEAK_DEFAULTS
#    entry silently renders the template's default theme with every gate green.
python3 - "$H" <<'EOF'
import re,sys
t=open(sys.argv[1]).read()
attr=(re.search(r'<html[^>]*data-theme="([^"]+)"',t) or [None,None])[1]
dflt=(re.search(r'"theme":\s*"([^"]+)"',t) or [None,None])[1]
keys=dict(re.findall(r'"([^"]+)":\s*"([^"]+)"',(re.search(r'THEME_KEY\s*=\s*\{([^}]*)\}',t) or ['',''])[1]))
resolved=keys.get(dflt)
print(f'html data-theme={attr} · TWEAK_DEFAULTS.theme={dflt} · resolves to={resolved}')
print('OK' if resolved==attr else f'MISMATCH — the deck will render as "{resolved}", not "{attr}"')
EOF
```

## Visual verification — delegate the rendering to `visual-verify`

A deck is a visual artifact, so **rendering and looking is the gate**, and it now
lives in one place instead of being re-implemented here. Pick the tier by stakes:
**smoke** while iterating · **standard** before any done-claim · **flagship** for
customer/conference decks.

```bash
SKILLS=${SKILLS:-$(ls -d ~/.claude/skills ~/.agents/skills ~/.cursor/skills 2>/dev/null | head -1)}
vv=$SKILLS/visual-verify/scripts
# smoke — one slide, one look
"$vv/render.sh" shot "file://$H" /tmp/deck-qa-1.png 1920 1080 2500

# standard / flagship — every slide, both themes, contact-sheeted into ONE image
"$vv/matrix.sh" "file://$H" /tmp/deck-matrix --states '#1,#2,#3,#4' --viewports 1920x1080
"$vv/contact-sheet.sh" /tmp/deck-matrix /tmp/deck-sheet.png
```

Then **read the images** and check: display font is the intended face (not a
fallback), logo visible, no overflowing or clipped text, thumbnail rail
populated, no blank canvas (blank = a JS error — confirm with a console run).

**Two deck-specific traps, both real:**

- **Count-ups are caught mid-tween.** `[data-count]` elements animate on
  slide-enter, and a timed headless screenshot advances timers but *not* the
  animation clock — the same deck screenshotted twice can show `43` and then
  `45` under a label claiming 45. Force the settled state in a **throwaway copy**
  (`*{transition:none!important;animation:none!important}`) before you judge any
  number on a slide. Never edit the real deck for this.
- **Settled-copy overrides need to WIN.** A throwaway copy's
  `*{animation:none!important}` is not enough: (a) gated `.reveal`/`.pop` base
  states are hidden, so also force `.reveal,.pop{opacity:1!important;transform:none!important}`;
  (b) `deck-fragments.js` injects its own `opacity:0!important` pending rule at
  runtime — beat it with higher specificity (`html body [data-frag]{...}`);
  (c) `[data-count-honest]` is JS-driven (rAF), so settle-CSS never freezes it —
  judge those numbers from the markup attribute, not the pixels.
- **Headless screenshots freeze CSS animation clocks.** A keyframe that gates
  visibility in `opacity` can render elements invisible in QA shots (and only
  there). For anything you must verify visually, make entrance keyframes
  transform-only and let opacity come from the base state.
- **Cloning slides (overview walls, thumbnails): deck-stage virtualizes
  off-window sections with inline styles/hidden attrs.** A `cloneNode` carries
  that state and renders blank — wipe `clone.style.cssText`, drop `hidden`/ids,
  and force final reveal states inside the clone container.
- **Positioning containers must not rely on CSS transforms when any child (or
  the container itself) carries `.reveal`/`.pop`** — those animations end at
  `transform:none` and silently wipe a `translateY(-50%)` centering. Center
  with flex instead.
- **Font fallback is silent.** If the deck uses a `design-kit` theme, paste
  `dk.py assert-fonts <theme> <pairing>` into a throwaway copy and run
  `visual-verify`'s `fontload` check. A deck rendering in a fallback stack looks
  plausible and is wrong. Note a `false` for a weight the deck never actually
  renders is lazy-loading, not a bug — see `design-kit/references/fonts.md`.

## Content checks

- Titles are assertions, one idea per slide; numbers on slides are real and current (query_intelligence stats, not remembered counts).
- No internal ticket-numbering / adoption language (content discipline applies to decks).
- Emphasis via `c-*` classes; type sizes from the scale in grammar.md only.
- Dividers every 4–8 content slides; deck length matches the declared type budget (narrative.md).

## Optional deep pass

Dispatch `persona-walkthrough` agent on the rendered screenshots for audience-fit friction, and `brand-guardian` when the deck is customer-facing.
