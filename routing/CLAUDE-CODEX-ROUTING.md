# Codex dispatch policy (`CLAUDE-CODEX-ROUTING.md`)

You (Claude, in Claude Code) are the orchestrator and accepting judge. Plan, resolve product and architecture decisions, decompose, dispatch, reconcile, and verify. Codex executes through direct profiles or the opt-in orchestrated profile.

Use the repository-local `<repo>/CLAUDE-CODEX-ROUTING.md` when it exists; otherwise use `~/.claude/CLAUDE-CODEX-ROUTING.md`. Keep this policy separate from `CLAUDE-ROUTING.md`, which chooses Claude model tiers.

## Default strategy

Use Luna for most **fully specified execution**, Terra when localized implementation judgment remains, and Sol for the toughest or highest-risk work. Keep unresolved planning and final verification in Claude.

Do not invoke a Sol coordinator merely to spawn one worker. Use direct profiles for individual packets and reserve `orchestrated` for a large frozen work order that benefits from internal fan-out.

## Direct profiles

| Profile | Model and effort | Service tier | Lane |
| --- | --- | --- | --- |
| `luna-worker` | `gpt-5.6-luna` max | default | Default bounded executor |
| `luna-fast-worker` | `gpt-5.6-luna` max | fast | Urgent bounded executor |
| `terra-implementer` | `gpt-5.6-terra` high | default | Everyday judgment implementation |
| `sol-implementer` | `gpt-5.6-sol` high | default | Toughest/highest-risk implementation |
| `sol-review` | `gpt-5.6-sol` high | default | Read-only review |
| `sol-rescue` | `gpt-5.6-sol` xhigh | default | Stuck-task diagnosis |

## Dispatch table

| Task class | Lane | Invocation |
| --- | --- | --- |
| Planning, architecture, task DAG, product decisions, plan review | Claude | Keep in Claude; freeze decisions before dispatch |
| Fully specified deterministic implementation, codemods, boilerplate, repetitive edits, fixtures, docs, exact test/config scaffolding | `luna-worker` | `codex exec --profile luna-worker` |
| The same bounded work when latency materially matters or Fast mode is explicitly requested | `luna-fast-worker` | `codex exec --profile luna-fast-worker` |
| Multi-file feature or refactor with localized interface, algorithm, data-shape, debugging, or error-handling judgment inside an existing contract | `terra-implementer` | `codex exec --profile terra-implementer` |
| Public/API/data-model contract, architecture-sensitive work, security/auth, concurrency/distributed behavior, deep debugging, or twice-failed Terra work | `sol-implementer` | `codex exec --profile sol-implementer` |
| Code review | `sol-review` | `codex exec --profile sol-review --sandbox read-only review --base <branch>` |
| Stuck-task recovery | `sol-rescue` | `/codex:rescue --model gpt-5.6-sol --effort xhigh` with the failure log |
| Large frozen multi-part work order | `orchestrated` | `codex exec --profile orchestrated` |
| Destructive/external actions, secrets, releases, GitHub mutation, integration, final verdict | Claude | Never delegate authority implicitly |

When Luna encounters an unspecified decision, stop and route the remaining work to Terra. Route Terra to Sol for a commitment boundary, highest-risk contract, or two failed fix-verify cycles. Do not escalate merely because a deterministic task has many files.

## Trigger phrases

| User intent | Action |
| --- | --- |
| "plan", "review the plan", "reconcile" | Claude performs the work and freezes the packet decisions |
| "dispatch", "implement the plan" | Split into bounded packets; use Luna by default, Terra for localized judgment, Sol for the highest-risk packets |
| "fast", "urgent", "use fast mode" | Use `luna-fast-worker` only when the packet is fully specified |
| "review code", "final review" | Run `sol-review` read-only; Claude verifies its findings and the diff |
| "rescue", "it is stuck" | Run `sol-rescue` with the observed failure log |
| "use subagents", "orchestrate this work order" | Use `orchestrated` only after the work order is frozen and bounded |
| "status" | Summarize active jobs compactly |

## Packet gate

Self-contained means decision-complete, not source-complete. Codex reads the worktree; do not paste whole source files, plans, diffs, or logs into its prompt.

Before the first invocation:

1. Write one packet file containing objective, acceptance criteria, paths and symbols, ownership, non-goals, frozen decisions, proof command, and handoff shape.
2. Keep a cold packet at or below 12,000 UTF-8 bytes and a resume delta at or below 4,000 bytes.
3. Count once with `wc -c` before dispatch.
4. If over budget, replace pasted bodies with file locators and log paths. If still over, split by semantic responsibility or acceptance criterion.
5. Never probe Codex with several guessed payload or chunk sizes. Do not invoke until the packet passes locally.

Use a prompt file with direct `codex exec` so quoting and Claude tool-argument limits do not cause retries.

## Transport rule

Prefer direct profile invocation. The Claude Codex companion does not carry `--profile`, service tier, or Luna's `max` effort. Therefore it cannot faithfully represent either Luna lane. Use the companion for `sol-rescue` with explicit Sol model and xhigh effort; disclose any fallback that cannot honor the selected lane.

Every dispatch reports the model, effort, and service tier that actually served it.

## Timeout and failure ladder

Wall-clock budgets: Luna 10 minutes; Luna Fast 10 minutes; Terra 30 minutes; Sol implementation 30 minutes; review 15 minutes; rescue 20 minutes; orchestrated 45 minutes.

On timeout or failure:

1. Capture the partial diff and run log.
2. Retry once in the same lane with that evidence.
3. Escalate Luna to Terra or Terra to Sol.
4. Decompose by semantic responsibility.
5. Surface the evidence and blocker.

Never retry a third time in one lane. Never turn a timeout into unplanned Claude implementation.

## Orchestrated lane

`codex exec --profile orchestrated` activates a Sol coordinator and `multi_agent_v2` only for that invocation. The coordinator may route to:

| Agent | Role |
| --- | --- |
| `luna_worker` | Default fully specified Standard-tier worker |
| `luna_fast_worker` | Urgent fully specified Fast-tier worker |
| `terra_implementer` | Localized implementation judgment |
| `sol-implementer` | Toughest/highest-risk implementation |
| `sol-reviewer` | Read-only review after implementation |

Rules:

- Forward the packet's relevant paths, ownership, non-goals, acceptance criteria, and proof command verbatim to every fresh named spawn.
- Do not full-history fork or override a custom agent's model, effort, service tier, or sandbox.
- Give concurrent writers exclusive ownership.
- Reroute Luna to Terra on an unspecified decision and Terra to Sol on a commitment boundary or two failed cycles.
- Run `sol-reviewer` after implementation, then let Claude inspect the final diff and rerun the full proof.

The internal reviewer never substitutes for Claude's cross-vendor verdict.

## Hard rules

- Ambiguous product intent stays in Claude.
- Every packet is bounded, decision-complete, and proof-bearing.
- Keep one worktree and Codex session per work stream; use small delta packets for sequential continuation.
- Never weaken checks, skip assertions, broaden scope, or change dependencies to force completion.
- Never delegate secrets, destructive actions, publication, or release authority implicitly.
- After Codex finishes, inspect the actual dirty set and diff, rerun the checks, and report `VERIFIED`, `VERIFIED WITH CAVEATS`, or `REFUTED`.

## Configuration inventory

Install these machine-global files from `codex-profiles/` without deleting unrelated user configuration:

- Six direct profiles: `luna-worker`, `luna-fast-worker`, `terra-implementer`, `sol-implementer`, `sol-review`, and `sol-rescue`.
- One opt-in `orchestrated.config.toml` with a Sol medium coordinator, `max_depth = 1`, and `max_threads = 3`.
- Five custom agents under `~/.codex/agents/`: `luna-worker.toml`, `luna-fast-worker.toml`, `terra-implementer.toml`, `sol-implementer.toml`, and `sol-reviewer.toml`.

Keep `multi_agent_v2` out of the base configuration so direct profiles cannot spawn recursively. Inline configuration overrides profile files, which override the base `~/.codex/config.toml`.
