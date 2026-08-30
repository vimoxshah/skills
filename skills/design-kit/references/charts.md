# Charts — ramps are authored, never derived

## Why the theme carries them

A 6-token UI palette cannot be turned into a legible chart ramp by machine.
Categorical series need **perceptual** separation (not just different hues);
sequential ramps need **monotonic lightness** or the reader cannot order them;
diverging ramps need a neutral midpoint that reads as neutral. Deriving these
from `--accent` and friends produces charts that are pretty and unreadable.

So every theme authors four things explicitly:

```yaml
charts:
  categorical: [...]   # 6 hues, perceptually distinct, hero hue first
  sequential:  [...]   # 6 steps, lightness strictly increasing or decreasing
  diverging:   [...]   # 5 steps, neutral in the middle
  good: "#..."         # semantic — NOT the accent
  bad:  "#..."
```

The adapter's only job is delivery. It does not compute ramps.

## The gate — `scripts/check-ramps.py`

Run this whenever a `charts` block is authored or edited. It is the gate, and it
exits with the failure count so it can guard a script:

```bash
SKILLS=${SKILLS:-$(ls -d ~/.claude/skills ~/.agents/skills ~/.cursor/skills 2>/dev/null | head -1)}
python3 $SKILLS/design-kit/scripts/check-ramps.py            # all themes
python3 $SKILLS/design-kit/scripts/check-ramps.py festival   # one theme
```

Three assertions, each using the metric that actually applies:

| Assertion | Metric | Threshold |
| --- | --- | --- |
| Categorical hue is legible on the theme ground | WCAG contrast ratio | ≥ 3.0 |
| Categorical hues are distinguishable from each other | **CIE76 ΔE in Lab** | ≥ 20 |
| Sequential ramp encodes order | luminance monotonic | strict |
| `good` vs `bad` are unmistakable | CIE76 ΔE | ≥ 40 |

**Why two different metrics.** Contrast ratio is a *lightness* metric — correct
for "does this mark separate from its background", useless for "are these two
series different colours". `#E4572E` (orange) and `#0F8B8D` (teal) sit at almost
the same lightness (ratio 1.12) and are obviously distinct to the eye. Judging
categorical separation by contrast ratio produces both false alarms and, worse,
false passes on two neighbouring purples. Perceptual distance sees hue.

Current state: **184 assertions, 0 failures** across all 8 themes. Six hues were
adjusted and three replaced during authoring because they failed these checks —
authored-by-judgment ramps do not survive contact with the metric, which is
exactly why the gate exists.

## Wiring into `dataviz`

`dataviz` ships a deliberately swappable placeholder palette and documents
`references/palette.md` as the file to replace. That is the seam:

1. Read the theme's `charts` block (`dk.py show <theme>`).
2. Substitute those values where `dataviz` reads its palette.
3. If `dataviz` exposes its own validator, run that too — it is additive to
   `check-ramps.py`, not a replacement.

## Authoring notes beyond the gate

- **Never hue-only:** in `cobalt-grid` (print-first) meaning must also be carried
  by position, label, or pattern — greyscale printing destroys hue, and the
  monotonic-luminance check only protects the *sequential* ramp.
- **Semantic separation:** `good`/`bad` come from the theme's `semantic` block,
  never from the accent. If the accent *is* green, `good` still needs to be
  distinguishable from a normal series.
- **Colour-vision deficiency is not covered** by the checks above. A red/green
  pair can clear both thresholds and still collapse under deuteranopia — if a
  chart's meaning rests on red-vs-green, add a non-colour encoding.

## Honest quantity encoding still applies

The theme gives you colors; it does not excuse the encoding rules in
`visual-verify` §5. In particular: never draw N marks and label them 10N, use a
log axis when the exact ratio matters, and remember that bar length reads as
linear. A themed chart that lies is worse than an unthemed one, because it looks
authoritative.
