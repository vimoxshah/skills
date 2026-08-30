# Narrative — how house decks are arc'd

## Deck types & slide budgets (observed norms)

| Type | Slides | Example |
| --- | --- | --- |
| Ultra-compact one-pager | 4–6 | Simple One-Pager |
| Executive summary | 13–21 | One-Pager, Vision |
| Focused technical | ~19–28 | MCP Thin Layer, Mobile+FE Intelligence |
| Flagship narrative | ~36 | Agentic OS |
| Comprehensive pitch | ~50 | MCP Server pitch |

Median ~20–25. Ask the audience + time budget first; pick the smallest type that carries the ask.

## Proven arcs (steal one)

1. **Flagship / vision** (Agentic OS): Title → The Shift (core idea) → The Workflow → The Commands/Mechanism → Architecture layers → Intelligence → The Payoff → Close (the ask).
2. **Product pitch** (MCP Server pitch): Title → Problem → Customer pain → What customers want → Product → Mechanism/catalog → Demo → Technical rigor (errors, schemas, principles) → Phases/rollout → Decisions → Close. Labels numbered `01…NN`.
3. **Patterns/teaching** (MCP Thin Layer): Hook → Part-1 deep example → Divider "N more patterns" → one `s-pattern` slide per pattern (before/after) → synthesis → close.

Rhythm rule: a `moment center` divider every 4–8 content slides; a dark/terminal "demo beat" mid-deck; one idea per slide — split rather than shrink type.

## The feeling curve (write it into the outline gate, not as a separate step)

Before scoring the 2–3 candidate arcs (SKILL.md Step 2), add one line per slide to each: the feeling it should land, then what on the slide causes it (a number, a diagram, a demo, a hard cut to the terminal panel). The feeling is the constraint; the cause is where a slide's archetype gets picked, and it comes second — a slide chosen before the feeling is a slide looking for a reason.

**If two adjacent slides in a candidate arc land the same feeling, one of them is filler** — merge it into its neighbor or cut it before it gets built, not after a run-through reveals the room going flat twice.

Name the deck's one peak slide in the same pass — the moment the audience should still be talking about after the deck closes (a `moment center` divider, the terminal demo beat, or an oversized-display stat, whichever the arc actually earns; taste.md's single-world-light rule still decides which surface that is). Give it the most build-up in the arc around it and the most speaking time in the notes. A deck with three "biggest moments" leaves the room able to say it was polished and unable to say what it was about.

A fast completion check for the peak, run against the outline before slides get built: finish "it's the deck where ___" from the audience's side. "It had a good demo slide" is a description, not a moment — it names a slide type, not what happened on it. "The live query answered on stage in under a second, no mock data" is a moment: it names the specific thing the room saw. If the sentence only makes sense to someone who already read the deck, the peak is not there yet.

## Voice & tone (from the design-system README)

Utilitarian and direct — facility-ops software, not consumer marketing. Second person for actions, system-voice for status. **No hype adjectives**; numbers and named mechanisms carry the persuasion (real counts: commands, agents, tools, ms latencies). Titles are assertions ("A smarter model alone won't ship our fleet"), not topics ("Model limitations").

## Content discipline

Applies here too: no internal ticket-numbering (Gap NN, A-NNN) or adoption-funnel language on slides — describe what shipped and what it does. Real metrics only — if a number isn't verified, don't put it on a slide (statistician agent can pressure-test claims).

## Audience calibration

- **Leadership/exec**: one-pager or exec type; payoff slides early; ≤1 terminal beat; decisions framed as trade-offs made.
- **Engineering**: technical/flagship; mechanism slides (`s-pattern`, terminal, code) dominate; keep speaker notes dense — the deck stays sparse.
- **Customers/partners**: pitch arc; their pain in their words first; product mechanism second; a customer-facing theme rather than the house purple theme.
