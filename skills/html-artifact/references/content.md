# Content integrity — what the page says

Build mechanics are the easy half. These are the failures that survive a clean
technical gate and still make the artifact wrong, or make it land badly.

## Never narrate your own process

A deliverable is not a changelog of how you produced it. Findings, corrections,
verification method, "we got X wrong and fixed it" — that is *your* work, not
the reader's problem, and putting it on the page invites doubt rather than
settling it.

> A deck once opened with a slide titled *"Every number here was checked against
> source"* above a table of the author's own earlier mistakes. It read as
> defensive. Replaced with a slide of plain facts, it read as authoritative —
> and the rigour moved into an optional detail panel for anyone who asked.

**Rule:** lead with the finding. Keep method one layer down — a dive tab, an
appendix, a footnote. The reader who wants to audit you will look; the reader
who doesn't should never have to.

The exception is a **correction that changes a decision already taken**. If
someone acted on the old number, say so plainly and once.

## Choose the number that carries the stake

Every stat is an argument. The wrong one argues against you.

| Reads as small | Reads as true |
| --- | --- |
| "~20 files touched" | "100% of outbound calls rewritten" |
| "8 API operations" | "0 automated tests today" |
| "2 config rows" | "1 attempt at cutover" |

Same project, opposite impressions — and only the right-hand column is
load-bearing for the decision being asked for. When a stat is *technically
accurate but rhetorically wrong*, it is the wrong stat, not a presentation
problem to be fixed with adjectives.

**Test:** read the stat row alone. Does it imply the conclusion the page argues?
If a reader could skim only those five numbers and reach the opposite view, the
numbers are miscast.

Beware the accompanying prose too — a lede saying *"smaller than it looks"*
undoes five carefully chosen stats above it.

## A number that makes the work sound easy has been measured too narrowly

This is the most reliable smell in technical writing.

> "~5 files change" survived several review passes because it *sounded like a
> fact*. It had counted one folder and ignored every caller that passed an
> identifier — which was precisely where the change landed. The real figure was
> four times higher, and the low number made a correct effort estimate look
> padded.

When a figure is reassuring, re-derive it from the other direction before
publishing: not "which files do I plan to edit?" but **"what would break if I
didn't?"** Grep for the identifier, the import, the column — count what comes
back.

Two figures that contradict each other in tone ("one small layer" + "six weeks")
mean one of them is wrong. Find out which before a reader does.

## Keep a document set internally consistent

When a body of work is split — required vs deferred, phase 1 vs phase 2 — stale
tables silently carry the wrong scope.

> An effort table written before a scope split still priced three deferred items
> inside the required estimate, including a UI that had been explicitly moved out.
> The deck said "0 frontend days"; the doc said 4. The deck was right.

**On every scope change, re-read every table that sums anything.** Totals are
where drift hides, because nobody re-derives a total they have already seen.

Cross-check before publishing: does each headline number appear identically
everywhere it appears? Pick one canonical source and make the others match it
explicitly, not approximately.

## Rank your sources, and say which one you trusted

When two sources about the same system disagree, the disagreement is the finding —
but only if you rank them correctly before drawing a conclusion.

> A vendor's training slide listed an API endpoint. The machine-readable spec did
> not contain it. The write-up concluded *"the spec is stale — re-pull it"* and
> shipped that as a recommendation. It was backwards: the endpoint had never
> existed, and the **slide** was aspirational. A real constraint — that resource
> could not be created at all — was inverted into a tooling errand.

**Default ranking for a system you do not own:**

1. **The running system** — a response you captured, a query you ran
2. **Machine-readable contract** — OpenAPI/JSON schema, a migration file, source
3. **Reference documentation** — API docs written to be correct
4. **Prose and slideware** — training decks, marketing pages, onboarding guides

Levels 3 and 4 describe *intent*; levels 1 and 2 describe *behaviour*. A slide
deck is not a contract: its tables carry endpoints that were planned, renamed or
withdrawn, and nobody regenerates them.

**When they conflict, say so on the page** — "the guide lists X; the spec does
not, and the spec is authoritative here" is more useful than silently picking
one, because it tells the reader which source to stop trusting.

**Watch the direction of your conclusion.** "The lower-ranked source is wrong" is
usually right and usually boring. "The higher-ranked source is stale" is a strong
claim that needs its own evidence — a changelog, a version, a live check. If you
reach for it, ask whether you are explaining away a fact you did not like.

## Sourcing

Every number on the page came from something you ran. A shared artifact outlives
the conversation that produced it, and an untraceable figure becomes fact by
repetition.

- **Measured** — state it plainly.
- **Inferred** — say so on the page: a chip, a parenthetical, "pending
  confirmation". Confident wrong numbers are worse than visible gaps.
- **Assumed** — either verify it or make the assumption a line item in the risks.

Derive headline stats from the data on the page where you can (see
`dynamism.md`), so a summary and its table cannot disagree.

## Don't hardcode anything derived from today

A countdown, an age, a "days remaining" — computed once and pasted in, it is
wrong the next morning and nobody notices, because it still looks like a number.

Either compute it at render time, or **state the absolute fact instead**: not
"55 days left" but "30 September 2026". Dates do not rot.

## Titles

A title is read by people who will never open the page. Make it name the thing,
not evoke it. `"STid Legacy to V3 API Migration"` beats a clever line, and it is
what someone searches for six weeks later.

Put urgency in the kicker or lede where it can be specific — a date, a
consequence — rather than compressing it into a headline that then says less.
