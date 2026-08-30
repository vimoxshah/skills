# Mapping mode — findings onto the project's surfaces, and into a plan

Load after reading. This is where a paper becomes a decision.

## The ranking rule: contradiction first

Order findings by how much they **change what we do**, not by topical closeness:

1. **Contradicts a premise the project ships** — highest value. A paper refuting a
   pattern we ship is worth more than ten that validate one.
2. **Names a mechanism the project lacks, with an existing home** to put it in.
3. **Validates a bet** — useful for the roadmap narrative, but
   not work.
4. **Adjacent but not actionable** — record in a table so it is not re-triaged
   next sweep.

Adjacency is what produces a 40-row table nobody reads. The discriminating
question is never "is this topic near the project" — it is **does it name a mechanism we
lack, or contradict a premise we ship?**

## Finding the existing home

The profile's `surfaces` map (see `profiles/generic.json`) is the map. Per **Surface Authoring
Discipline**, run this in order and stop at the first hit:

1. Can an **existing predicate** trigger it? (`kind: frontend`, an `intent:`
   value, a diff-path pattern, an `enforce.*` gate)
2. Can an **existing surface** absorb it as a conditional branch or a new
   `query_intelligence` op / router op?
3. Only with **explicit user approval** — a new surface. Default answer is no.

**Never propose a new command, skill, or agent in a research writeup.** If
nothing fits, write "no existing home — this needs a design decision first" and
let the lead decide. That is a more useful output than an invented surface.

### Homes that absorb most research findings

| Finding shape | Existing home |
| --- | --- |
| A verification or aggregation method | the project's review / release-gate surfaces |
| A measurable behavioural claim | the project's eval suite (golden fixtures) or prompt-optimisation loop |
| A per-tool or per-op quality signal | op-call telemetry → warehouse view → insights dashboard |
| A memory / knowledge-retention mechanism | `learn_write` scopes, `platform-decision-record`, `replay-learnings` |
| A context or truncation result | read discipline, `context-surface-slim`, `.claude/rules` scoping |
| A budget / early-stopping mechanism | autonomous lanes, doom-loop detection, worktree isolation |
| A structural-output or decomposition result | collection lanes, workflow pipeline guidance |
| A skill-accumulation result | skill-health checks, prompt-optimisation loop |

## Two invariants that constrain every recommendation

- **Structure-only telemetry.** The project never exports raw values, paths, prompts, or
  outputs. A recommendation requiring trajectory *content* is out of scope;
  rephrase it against structure (op name, scope shape, outcome) or drop it.
- **`decisions.md` is append-only** with a CI-enforced sentinel and one writer
  (`learn_write`). A memory-mechanism recommendation must preserve both. A status
  facet on an appended entry is fine; a mutable store is not.

## What we cannot use

Assume the project is a **harness, not a training stack.** Anything needing model training,
LoRA adaptation, RL, or hidden-state access is out of reach. The transferable
content from those papers is their **benchmark and protocol design**, not their
method. Say that explicitly rather than filing it as actionable.

## Writeup gates — both must pass

```bash
SKILLS=${SKILLS:-$(ls -d ~/.claude/skills ~/.agents/skills ~/.cursor/skills 2>/dev/null | head -1)}
node $SKILLS/arxiv/scripts/verify-citations.js \
  --report docs/analysis/<file>.md --corpus /tmp/corpus.json   # must exit 0
bash scripts/check-content-discipline.sh                        # published surface
```

The citation gate catches figures paraphrased into existence — including the
subtle class where a paper's "fewer than half" becomes ">50%" in your prose. It
found exactly that in the reference run, in a document that had already been
hand-verified. Trust the gate over your own recollection.

Then re-check by hand what no script can: **every claim about the project carries a `file:line`
you opened.** A tool description is not evidence.
