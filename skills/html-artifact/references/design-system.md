# Design system — tokens, theming, type under CSP

## The three-layer theme block

The viewer's OS sets `prefers-color-scheme`; the viewer's in-page toggle stamps
`data-theme="dark"` or `"light"` on `:root`. **The toggle must win in both
directions**, which a media query alone cannot do. Style components through
tokens only — never write colors inside the media query.

```css
:root{
  /* light is the base layer */
  --ground:#E7E9EC; --raise:#F3F5F7; --sunk:#DDE1E6;
  --ink:#10161C; --ink-soft:#43535F; --ink-faint:#6E8091;
  --rule:#C3CBD3; --rule-soft:#D6DBE1;
  --accent:#106661; --accent-bg:#D6E9E7;
  --warn:#A85B1C;   --warn-bg:#F2E3D4;
  --alert:#A0302D;  --alert-bg:#F5DDDC;
}
@media (prefers-color-scheme:dark){ :root{ /* …dark values… */ } }
:root[data-theme="dark"]{  /* same dark values — beats the media query */ }
:root[data-theme="light"]{ /* same light values — beats the media query */ }
```

Yes, the dark values are written twice. That duplication is the mechanism; a
`@media` block cannot be overridden by an attribute selector of lower
specificity, so the explicit `[data-theme]` layers must restate them.

**Token naming that survives:** name by *role* (`--ground`, `--ink-soft`,
`--rule`), never by appearance (`--grey-200`). Role names stay true when the
theme flips; appearance names become lies.

**Semantic ≠ accent.** `--alert` / `--warn` / `--accent` carry meaning and are
separate from any decorative hue. Reserve `--alert` for the one or two things
that genuinely break; if everything is red, nothing is.

## Neutrals

A pure mid-grey reads as unconsidered. Bias the neutral slightly toward the
accent's hue — a blue-slate grey under a teal accent, a warm grey under amber.
The reader will not name it; they will register that it was chosen.

## Type under the CSP

Font CDNs are blocked and fail *silently* — you get a fallback and never see
the error. Two legitimate options:

**A. Inline as `@font-face` data URI.** You no longer need the bytes on hand —
`design-kit` fetches them. Google's `css2` API serves pre-built per-subset woff2,
so the latin cut of a real display face is **10–24 KB**, not the 100–300 KB a
full unsubsetted weight costs:

```bash
SKILLS=${SKILLS:-$(ls -d ~/.claude/skills ~/.agents/skills ~/.cursor/skills 2>/dev/null | head -1)}
dk=$SKILLS/design-kit/scripts/dk.py
python3 $dk list fonts                       # 8 pairings, with their voice
python3 $dk fetch anton-archivo
python3 $dk compile festival anton-archivo --surface artifact --strict
# -> data-URI @font-face rules + the full three-layer token block
```

Use `--strict` so a failed fetch **cannot** be silently reported as success, and
paste `dk.py assert-fonts …` into the page so `visual-verify`'s `fontload` check
proves the face actually applied. Two caveats worth knowing before you trust that
check: `document.fonts.check()` returns false for a declared weight the page
never renders (lazy loading, not a bug), and true for a family you never declared
at all (fallback match) — see `design-kit/references/fonts.md`.

**Licensing is not optional here.** Inlining bytes into a page you publish is
redistribution. OFL faces are fine; a commercial face is not. design-kit refuses
that combination in code rather than trusting you to remember.

**B. System stacks, chosen deliberately.** Usually correct. Pick for voice:

```css
--mono:ui-monospace,SFMono-Regular,Menlo,"Cascadia Mono",Consolas,monospace;
--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
--serif:ui-serif,Georgia,"Iowan Old Style","Times New Roman",serif;
```

A real pairing needs a *reason*. Monospace headings on a technical piece read
as instrument panel and belong to the subject. Serif headings on a narrative
report read as editorial. Sans headings on a sans body is not a pairing.

**Rules that hold everywhere:** running text near 65ch; one type scale, stay on
it; `text-wrap:balance` on headings; uppercase labels get `letter-spacing`
around `.13em`; `font-variant-numeric:tabular-nums` anywhere digits align.

## Layout

- Space with flex/grid `gap`, not per-element margins that collapse or double.
- Wide content gets its own `overflow-x:auto` container. The page body must
  never scroll sideways.
- Watch selector specificity. A type selector (`.section`) fighting a modifier
  (`.cta`) over padding silently undoes your spacing — structure the cascade so
  later rules extend rather than cancel.

## Copy

Words are design material. Write from the reader's side: name things by what
they recognize, not how the system is built. Active voice. A control says what
happens. Errors say what went wrong and how to fix it. Specific beats clever.

Structural devices must encode something true. Numbered rails imply sequence —
use them only where order carries information the reader needs.
