# Deep-read mode — one paper, LaTeX source, grounded in our code

Load when the developer gives a paper URL/id and wants it understood, or when a
sweep finding is about to become a recommendation.

## 1. Pull the source, not the PDF

```bash
SKILLS=${SKILLS:-$(ls -d ~/.claude/skills ~/.agents/skills ~/.cursor/skills 2>/dev/null | head -1)}
node $SKILLS/arxiv/scripts/fetch.js --source 2608.03506
```

Returns `{ dir, entry, tex_files }`. `entry` is the `.tex` holding
`\documentclass`. Read it, then follow `\input{}` / `\include{}` recursively.

**Why source over PDF or abstract:**

- The abstract omits the caveat that usually decides transferability — sample
  size, which models, whether it is simulation or measurement, what the ablation
  actually removed.
- Tables and appendices carry the numbers worth citing; the abstract rounds them.
- PDF text extraction mangles math and column order. LaTeX is the ground truth.

Cached at `~/.cache/arxiv-skill/src/<id>/` — a re-read is free.

## 2. Read for the four things that decide relevance

Extract these before forming any opinion:

1. **The mechanism.** What did they actually build? One sentence, no adjectives.
2. **The counterfactual.** What did it beat, and was the baseline honest? A paper
   beating a strawman transfers nothing.
3. **The transfer conditions.** Model sizes, domain, task shape. A result on
   mid-sized models doing math word problems may not survive contact with
   frontier models doing multi-file repo surgery — say so.
4. **Evidence class.** Measurement > simulation > argument. A simulation of
   developer behaviour is not a field study, however precise its percentages.

## 3. Ground it in our code before recommending anything

This is the step that separates a useful read from a plausible one.

**Every claim about the project must cite a file you opened.** Not a tool description,
not the skills listing, not recollection. In the reference run this exact
shortcut produced a wrong architectural claim: a shipped workflow's
devil's-advocate pass was described from its one-line summary as reading only
primary source, when `workflows/review-deep.js:134` shows it is shown the panel's
verdicts first — which inverted what the paper implied about it.

Use the intelligence layer first, then read the file:

```
query_intelligence({op:'lexical_search', arg:'<mechanism>', arg2:'service=<repo> max_hits=20'})
```

Then `Read` the hit and cite `file:line`. If the project has no such mechanism, that is a
finding — write "the project has no equivalent" rather than inventing a mapping.

## 4. Verdict shape

```markdown
### `<arxiv-id>` · <title>
**Mechanism.** <one sentence>
**Evidence class.** measurement | simulation | argument — <why>
**Transfer conditions.** <models, domain, what would break the transfer>
**Project equivalent.** <file:line> — or "none"
**Disposition.** Act | Test | Cite | Watch | Design | Drop
**Named home.** <existing surface — never a new command/skill/agent>
**If Act:** <the smallest change that tests the claim>
```

Any figure you quote must survive `verify-citations.js --source-dir` (which
searches the extracted LaTeX, so body-table numbers verify too):

```bash
node $SKILLS/arxiv/scripts/verify-citations.js \
  --report <doc.md> --corpus /tmp/corpus.json \
  --source-dir ~/.cache/arxiv-skill/src
```
