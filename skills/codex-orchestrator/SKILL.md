---
name: codex-orchestrator
description: Route bounded implementation work from Claude to Codex using Luna, Terra, and Sol profiles or an opt-in Sol-led subagent team. Use whenever Claude dispatches, resumes, reviews, or rescues Codex work, or when a Codex handoff is oversized, fails, or needs escalation.
---

# Codex Orchestrator Workflow

Keep planning, unresolved product and architecture decisions, integration, and the accepting verification verdict in Claude. Route execution to the narrowest capable Codex lane.

## Resolve the active policy

Use `<repo>/CLAUDE-CODEX-ROUTING.md` when it exists; otherwise use `~/.claude/CLAUDE-CODEX-ROUTING.md`. Treat a repository policy as a wholesale override of the global policy.

Keep the Claude-model router separate. `CLAUDE-CODEX-ROUTING.md` decides Claude versus Codex, the Claude router chooses a Claude tier, and this skill chooses a Codex lane. Fix overlapping ownership in the routing tables instead of arbitrating it per dispatch.

## Choose a dispatch mode

Use one of two modes:

1. **Single bounded packet:** invoke the selected profile directly. Do not start a Sol coordinator merely to spawn one worker.
2. **Large frozen work order:** use `--profile orchestrated`. Its Sol root may decompose independent packets, route Luna to Terra to Sol, request `sol-reviewer`, and assemble the result.

Claude still verifies the final diff in both modes.

## Resolve the direct profiles

The ready-to-run files live in `codex-profiles/` and layer over the user's base Codex configuration.

| Profile | Model and effort | Service tier | Use |
| --- | --- | --- | --- |
| `luna-worker` | `gpt-5.6-luna` max | default | Default executor for fully specified, deterministic work |
| `luna-fast-worker` | `gpt-5.6-luna` max | fast | The same bounded work when latency materially matters |
| `terra-implementer` | `gpt-5.6-terra` high | default | Everyday implementation judgment inside an existing contract |
| `sol-implementer` | `gpt-5.6-sol` high | default | Toughest or highest-risk implementation |
| `sol-review` | `gpt-5.6-sol` high | default | Read-only review; invoke with `--sandbox read-only` |
| `sol-rescue` | `gpt-5.6-sol` xhigh | default | Stuck-task root-cause diagnosis |

Do not override a profile's model, reasoning effort, or service tier casually. Report the model, effort, and service tier that actually served every run.

## Route by ambiguity and risk

Choose the narrowest capable lane:

| Lane | Route here | Escalate when |
| --- | --- | --- |
| `luna-worker` | Codemods, boilerplate, renames, repetitive transformations, fixtures, documentation, localized fixes, and test/config scaffolding where the packet states what to change and how | Any interface, algorithm, contract, data-shape, or error-handling decision remains |
| `luna-fast-worker` | The same fully specified work when the user requests Fast mode or latency has material value | The work is routine or any decision remains |
| `terra-implementer` | Multi-file features, medium refactors, debugging with competing hypotheses, localized interface choices, algorithms, and error handling inside a frozen contract | Architecture, public/API/data-model contracts, security/auth, concurrency/distributed coordination, or two failed fix-verify cycles |
| `sol-implementer` | Architecture-sensitive implementation, public contracts, security/auth, concurrency/distributed behavior, deep root-cause debugging, or evidence-carrying escalation from Terra | Product intent is unresolved or contradictory |
| `sol-review` | Independent read-only review against explicit acceptance criteria | A fix is required; return it to the responsible implementation lane |
| Claude | Planning, decomposition, product and architecture decisions, destructive/external actions, integration, and final verification | The decision has been frozen into a complete packet |

Route by ambiguity and blast radius, not file count. Keep large deterministic volume with Luna and decompose it. When uncertain between Luna and Terra, choose Terra. Use Sol only when risk, contract scope, or observed failures warrant it.

## Build a decision-complete packet

Treat **self-contained** as decision-complete, not source-complete. Codex shares the worktree and can read source files itself. Never paste whole source files, plans, diffs, or logs merely to make a packet self-contained.

Include:

1. One concrete objective.
2. Acceptance criteria.
3. Exact repository, worktree, owned files, and relevant symbols or interface signatures.
4. Non-goals and must-not-touch files, interfaces, and contracts.
5. Material decisions already frozen by Claude.
6. The exact verification command or evidence expected.
7. The handoff shape: changed files, observed proof, decisions made, and blockers.

For write work, state that the executor is not alone in the codebase, must preserve other edits, and must not revert unrelated changes. For either Luna lane, state both what to change and how. If that cannot be done, route to Terra.

### Preflight packet size once

Apply this deterministic budget before the first Codex invocation:

- cold packet: at most **12,000 UTF-8 bytes**;
- resume/delta packet: at most **4,000 UTF-8 bytes**.

Write the packet to a temporary file, then count it once:

```bash
packet_file="$(mktemp)"
# Write the packet to "$packet_file".
packet_bytes="$(wc -c < "$packet_file")"
test "$packet_bytes" -le 12000
```

If it exceeds the budget, do not invoke Codex and do not try a ladder of guessed chunk sizes. Perform one local rewrite:

1. Replace pasted code or documentation with `path + symbol/section + why it matters` locators.
2. Store a full failure log under `.orchestration/logs/` and include only its path plus the smallest relevant excerpt.
3. Remove repeated conduct rules already supplied by the selected agent definition.
4. If it is still too large, split by semantic responsibility or acceptance criterion, never by arbitrary byte ranges.
5. Measure each final packet once and dispatch only packets that pass.

Do not spend tool calls probing Codex with 8 KiB, 16 KiB, 32 KiB, or other trial sizes. A packet-size failure discovered after dispatch is a coordinator defect; rebuild locally before retrying.

## Invoke a direct lane

Use a prompt file so shell quoting and Claude tool-argument limits do not distort the handoff:

```bash
codex_bin="$(command -v codex)"
timeout_seconds=600
perl -e 'alarm shift; exec @ARGV' "$timeout_seconds" \
  "$codex_bin" exec --yolo -C <repo> \
  --profile luna-worker \
  -o /tmp/codex-last.md - <"$packet_file" 2>/dev/null
```

Set `timeout_seconds` from the lane budget below. Use `luna-fast-worker`, `terra-implementer`, or `sol-implementer` instead when the routing rule selects that lane. Use `sol-review --sandbox read-only review --base <branch>` for review. Exit code `142` means the alarm expired; capture the partial diff and log before retrying.

Use one Codex session per work stream and worktree. Send later packets through `codex exec resume --last` as delta packets. Start fresh when the worktree, model lane, or work stream changes, or when the session is poisoned.

## Use the Claude Codex companion carefully

The companion's task transport accepts `--model` and `--effort`, but not `--profile` or service tier. Its effort vocabulary also cannot express Luna `max`. Therefore:

- prefer direct profile invocation for Luna, Luna Fast, Terra, and normal Sol implementation;
- use `/codex:rescue` for the `sol-rescue` path with `--model gpt-5.6-sol --effort xhigh` and the failure log;
- never claim Luna Max or Fast was honored through the companion transport;
- if the direct path is unavailable, disclose the transport limitation instead of silently falling back to the base model.

A routing table is real only when the transport can carry the selected lane.

## Use the orchestrated lane only for frozen work

Invoke a large, frozen, self-contained work order with:

```bash
codex_bin="$(command -v codex)"
timeout_seconds=2700
perl -e 'alarm shift; exec @ARGV' "$timeout_seconds" \
  "$codex_bin" exec --yolo -C <repo> \
  --profile orchestrated \
  -o /tmp/codex-last.md - <"$packet_file" 2>/dev/null
```

The profile activates `multi_agent_v2` only for that run. Its Sol coordinator routes among:

- `luna_worker`: default fully specified worker;
- `luna_fast_worker`: urgent fully specified worker;
- `terra_implementer`: localized judgment lane;
- `sol-implementer`: highest-risk implementation lane;
- `sol-reviewer`: read-only first review.

Instruct the coordinator to:

1. Spawn each custom agent by name with a fresh context. Do not full-history fork or override its model, effort, service tier, or sandbox.
2. Forward the relevant packet elements verbatim in every spawn prompt. Named workers do not inherit the root packet automatically.
3. Give concurrent writers exclusive file ownership and run only independent tasks in parallel.
4. Reroute Luna to Terra on an unspecified decision and Terra to Sol on a commitment boundary or two failed cycles.
5. Spawn `sol-reviewer` after implementation and resolve its findings before assembly.

The internal reviewer is a first pass, not Claude's accepting verdict.

## Handle timeouts and failures

Use these wall-clock budgets: Luna 10 minutes, Luna Fast 10 minutes, Terra 30 minutes, Sol implementation 30 minutes, Sol review 15 minutes, Sol rescue 20 minutes, orchestrated work order 45 minutes.

On timeout:

1. Capture the partial diff and run log.
2. Retry once in the same lane with that evidence.
3. Escalate Luna to Terra, or Terra to Sol.
4. Decompose by semantic responsibility.
5. Surface the blocker with the evidence.

On acceptance failure, never retry a third time in the same lane. Carry the failure log when escalating. Do not weaken assertions, skip checks, broaden scope, change dependencies, commit, push, or mutate external systems merely to complete a dispatch.

## Verify before accepting

Treat the executor's report as claims, not evidence. Claude must:

1. Inspect `git status` and the actual diff.
2. Compare every touched file with ownership and non-goals.
3. Re-run the packet's proof command when safe and available.
4. Check changed tests for weakened assertions, skips, widened tolerances, or mocks replacing real behavior.
5. Check for false completion, scope creep, spec betrayal, secrets, and debris.
6. Resolve findings through the responsible lane.
7. Report `VERIFIED`, `VERIFIED WITH CAVEATS`, or `REFUTED` with observed evidence.

Never let an executor or same-vendor reviewer give the final accepting verdict on its own work.

## Preserve worktree and publication boundaries

Keep one worktree per independent concurrent stream and keep its working directory stable for session continuity. Never let one lane touch another lane's worktree.

Claude retains destructive operations, secrets, releases, GitHub mutations, and final publication. A timeout never authorizes Claude or a worker to broaden the task or publish changes.
