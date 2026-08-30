# Fonts — pairings, the pipeline, and the license gate

## Pairings are first-class

A pairing is a *voice*: display + body + mono, with tracking and transform. It
lives in `fonts/catalog.yaml` and is reusable across themes. Theme and pairing
are two independent picks, validated together — so "Festival with the editorial
serif" is a question the system can answer (*no, and here's why*) instead of a
thing that silently renders badly.

| Pairing | Voice | Good for |
| --- | --- | --- |
| `anton-archivo` | condensed caps marquee | launches, poster slides |
| `archivo-black-mono` | maximum-weight manifesto | workshops, one-pagers |
| `archivo-tight` | one family, weight-separated | dense technical content |
| `space-ibm` | instrument panel | engineering, demos |
| `fraunces-archivo` | high-contrast editorial | exec, vision |
| `newsreader-archivo` | reading serif | retros, narratives |
| `system-stack` | zero bytes, never fails | when the page should just be read |

## The pipeline (no fonttools required)

Google's `css2` API serves **pre-built woff2** per subset. `dk.py fetch` pulls the
`latin` block's URL and caches the bytes — so there is no `fonttools`, no
`brotli`, and no local subsetting step. Real measured sizes: **10–24 KB per
face**, ~14 KB for Anton 400. A full pairing inlines to roughly 50–85 KB, which
is nothing against the artifact budget.

```bash
SKILLS=${SKILLS:-$(ls -d ~/.claude/skills ~/.agents/skills ~/.cursor/skills 2>/dev/null | head -1)}
dk=$SKILLS/design-kit/scripts/dk.py
python3 $dk fetch --all          # every pairing; writes fonts/LICENSES.md
python3 $dk fetch anton-archivo  # just one
python3 $dk manifest             # regenerate the manifest from the cache
```

**Deck vs artifact emission differs on purpose:**

- `--surface deck` → `src:url('fonts/anton-400.woff2')`. Copy the woff2 files
  into a `fonts/` folder beside the deck. The deck then works **offline** — which
  matters, because the stock template loads its type from the Google CDN and a
  conference room with bad wifi renders fallback type.
- `--surface artifact` → `src:url(data:font/woff2;base64,…)`. Required: the
  artifact CSP blocks font CDNs, and it blocks them *silently*.

## The license gate

`LICENSES.md` is generated and has two license columns on purpose:

- **Declared** — what `catalog.yaml` claims.
- **Verified** — what the live Google Fonts metadata API asserts (`isOpenSource`;
  the API exposes no literal license string, so that boolean is the honest
  signal available).

A mismatch is flagged with ⚠ and listed at the bottom of the file. All seven
Google families in the catalog currently verify as open source.

A pairing whose `source: local` face is not open-source is never inlined into
a shared surface — `--surface artifact` substitutes `shared_surface_alternate`.

## Fail closed, always

Missing bytes never silently become a system stack. The compiler emits:

```css
/* !! FONT FALLBACK IN EFFECT — this page is NOT rendering its
   intended typeface. Reasons: */
/*   - Anton 400: no cached bytes (run: dk.py fetch <pairing>) -> falling back to stack */
```

…plus a stderr warning, and `--strict` exits nonzero. **Use `--strict` any time
you intend to report success.** Verified behaviour with the bytes deliberately
removed:

| Invocation | Exit | Side effects |
| --- | --- | --- |
| `--strict`, bytes missing | **2** | stderr warning + `FONT FALLBACK IN EFFECT` in the CSS |
| no `--strict`, bytes missing | 0 | same warnings, but success exit |
| `--strict`, bytes present | 0 | clean |

**It writes the file before exiting.** A nonzero `--strict` run still leaves a
valid-but-fallback `theme.css` on disk, on purpose — so you can inspect it — which
means a caller that ignores the exit code silently ships the fallback. If you
script this, check the exit code and delete or refuse the output; do not treat
"the file exists" as success.

## Prove it loaded

`document.fonts.check()` is the only thing that distinguishes "webfont applied"
from "silently fell back". A screenshot cannot: near-miss fallbacks look fine.

```bash
python3 $dk assert-fonts festival anton-archivo   # -> <script>window.__FONTS=[...]</script>
```

Paste into the page, then run `visual-verify`'s `fontload` check. Verified output
from the Festival demo deck:

```json
{"fontload":{"400 16px \"Anton\"":true,"400 16px \"Archivo\"":true,
 "600 16px \"Archivo\"":true,"400 16px \"IBM Plex Mono\"":true},
 "h1font":"Anton, ui-sans-serif, system-ui…","bg":"rgb(14, 11, 22)"}
```

`h1font` starting with the intended family — not the fallback — is the tell.

## A pairing must cover the weights the surface asks for

The deck template's CSS requests **`font-weight:800` on `h1`**, 700 elsewhere,
600/700 on mono and 500 on body. A pairing that declares only `[400]` produces no
error — the browser **synthesises** the missing weight by smearing the outline.

On a normal-width grotesque that is invisible. On an already-ultra-heavy
condensed face it over-inks every letterform, and the result is the vague
complaint "the fonts look bad" with nothing in any log. Every pairing here now
declares `400/500/600/700` for each family that ships them; `dk.py fetch` pulls
all of them (27 faces, ~2.1 MB cached).

Two faces are genuinely single-weight — **Anton** and **Archivo Black** — and
cannot be expanded. For those the compiler emits a weight-normalisation rule:

```css
/* 'Anton' ships only weight(s) [400], but the deck requests up to 800 on
   display selectors. Pin them so the browser renders the real face instead
   of a synthesised faux-bold. */
[data-theme="festival"] h1, [data-theme="festival"] h2, … { font-weight: 400; }
```

Gate it with `scripts/check-font-coverage.py`: it parses the requested weights
out of the template CSS and compares them against the catalog and the fetched
cache. A family that ships a weight the catalog omits is a **blocking** failure;
a genuinely single-weight face is an advisory, acceptable only because the
normalisation rule exists.

### Two traps in the fontload check

**1. Assert only the weights the page actually renders.** A browser loads a
declared `@font-face` lazily — if nothing on the page uses Archivo 600, that face
is never fetched and `document.fonts.check('600 16px "Archivo"')` returns
**false** even though the pipeline is perfectly healthy. Measured on the
generated showcase: four specs reported `false`, then
`document.fonts.load(spec)` flipped all four to `true`, confirming the faces were
fine and merely unused. So either assert the weights you actually set in CSS, or
`await document.fonts.load(spec)` before checking. **A `false` here is not
automatically a bug — verify which of the two it is before chasing it.**

**2. `check()` returns `true` for a family you never declared**, because it
matches a fallback. It only returns `false` for a *declared* face whose resource
failed. So the check catches "my @font-face is broken", not "I forgot to declare
a font" — pair it with the `h1font` computed-family readback above, which catches
the second case.
