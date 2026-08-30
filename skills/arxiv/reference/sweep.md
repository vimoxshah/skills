# Sweep mode — a category batch into a ranked must-read set

Load when the developer asks for "recent papers", a category scan, or "last N".

## 1. Fetch

```bash
SKILLS=${SKILLS:-$(ls -d ~/.claude/skills ~/.agents/skills ~/.cursor/skills 2>/dev/null | head -1)}
S=$SKILLS/arxiv/scripts
node $S/fetch.js --category cs.AI --count 200 --json /tmp/corpus.json
```

Other entry points:

```bash
node $S/fetch.js --query "agent memory verification" --count 50   # topic search
node $S/fetch.js --ids 2608.03506,2608.03744                      # specific papers
```

`fetch.js` caches under `~/.cache/arxiv-skill/`, pages at 100 with a 3s courtesy
gap, and prints the **date span**. Read that line — it is the honesty constraint
for the whole writeup.

### Why the API and not `arxiv.org/list/<cat>/recent`

The listing page carries titles only. Triage on titles alone is guessing: a
title-level read of a 200-paper list mis-indexed one paper as "Verifiable Memory"
when it was "TaskPress", which would have produced a citation pointing at the
wrong work. The API returns the abstract, so scoring and verification both have
something real to bite on.

### The one-day caveat

cs.AI now runs ~200 submissions/day. `--count 200` on a category is therefore
**one announcement batch**, cross-lists included — a fair random sample of the
week's work, not a survey of the field. If the developer wants a real span, page
further back and say how far:

```bash
node $S/fetch.js --category cs.AI --count 600 --json /tmp/corpus.json   # ~3 days
```

## 2. Triage

```bash
node $S/triage.js --corpus /tmp/corpus.json \
  --profile $SKILLS/arxiv/profiles/<name>.json --min 7 --out /tmp/triage.tsv
```

Two tiers come back:

- **`must_read`** — fired a `boost` pattern, i.e. named a mechanism the project ships.
  Kept regardless of `--min`. **Read every one.**
- **`candidate`** — broad topical match only (`axis_hits >= --min`). Skim.

Tune `--min` to land 25–45 kept from 200. Then sanity-check the profile:

- A boost firing on **>6% of the corpus is a topic, not a mechanism** — tighten
  it. Measured: `harness` and `spec_driven` each fired on 16–17/200 and buried
  the signal, while `majority_vote` and `failure_predict` fired on 1 each and
  caught the two most valuable papers.
- **>40% of the corpus scoring zero** means the axes are too narrow.
- Missing a paper you know matters means the **boost list is incomplete** —
  it should be derived from an inventory of what the project actually ships, not from
  whatever you happened to notice. Add the mechanism and re-run.

Always report the dropped count. Silent truncation reads as full coverage.

## 3. Read

Read every `must_read` abstract. Pull LaTeX source (`reference/deep-read.md`) for
any paper you will build a recommendation on — abstracts omit the caveat that
usually decides whether a finding transfers.

**If a read returns garbled, stripped, or truncated text, re-read it.** Do not
reconstruct a sentence from loose numerals: a fragment like
`34.0% 39.0%, 45 20 26.0%` carries no semantics, and a plausible sentence built
from it will be wrong. Re-dumping the abstract plain-wrapped at ~90 characters,
one paper per file, reads reliably when denser formats fail.

## 4. Hand off

Go to `reference/mapping.md` for the mapping and the writeup shape.

When the `must_read` set exceeds ~12 independent papers, stop reading serially
and run the workflow instead — it parallelises read + verify:

```
Workflow({ name: "arxiv-sweep", args: { corpus: "/tmp/corpus.json", triage: "/tmp/triage.tsv" } })
```
