---
name: scoped-worktree-delivery
description: Safely create or use Git worktrees, diagnose broken worktree topology, verify a real Git author identity, isolate changes, commit, and publish only when authorized. Use when a request mentions a named worktree, branch creation, dirty-tree preservation, commit or push scope, branch freshness, core.bare problems, or proof that refs and commits were not lost.
---

# Scoped Worktree Delivery

Use this workflow for Git work where repository topology, author identity, change
scope, or publication state must be proven.

## Non-negotiable rules

1. Obey the repository's `AGENTS.md` and command-wrapper conventions. Command
   examples below use `git`; add wrappers such as `rtk` when the repo requires
   them.
2. Resolve and report the exact repository and worktree path before changing
   anything.
3. Never invent or silently substitute a Git name or email.
4. Reject placeholder identities such as `t`, `t@t.com`, `Test User`,
   `test@example.com`, or `user@example.com`.
5. Never commit on a protected branch unless the user explicitly requested the
   protected-branch operation and repository policy permits it.
6. Never create a worktree, commit, fetch, push, amend, rewrite refs, or change
   Git configuration unless that action is in the user's scope.
7. Preserve unrelated tracked, staged, and untracked work.
8. A clean status does not prove that no commits were lost. Prove ref and commit
   continuity separately.
9. Push only when explicitly authorized.

## Start with the bundled preflight

Resolve `scripts/preflight.sh` relative to this `SKILL.md`, then run:

```bash
bash scripts/preflight.sh /absolute/path/to/repository
```

The script is read-only. It reports identity sources, topology, HEAD, branch,
upstream divergence from existing refs, and status. Interpret its exit code:

- `0`: identity and worktree topology are ready.
- `2`: Git identity is missing or looks like a placeholder.
- `3`: the target is not a Git repository.
- `4`: repository topology is inconsistent with a normal worktree.

Do not bypass a non-zero result. Diagnose it using the relevant section below.

## Phase 1: Resolve scope and authorization

Record:

- exact source repository path;
- exact target worktree path, if different;
- current and requested branch;
- requested base ref;
- allowed files or change boundary;
- required verification command;
- whether commit is authorized;
- whether fetch or push is authorized.

Inspect:

```bash
git worktree list --porcelain
git rev-parse --show-toplevel
git status --short --branch
git branch --show-current
git remote -v
```

Stop if the named worktree cannot be resolved unambiguously. Do not substitute
the main checkout for a requested worktree.

## Phase 2: Verify the real Git identity

Inspect both effective values and their sources:

```bash
git config --show-origin --get-regexp '^user\.(name|email)$'
git config --show-origin --get user.name
git config --show-origin --get user.email
git config --global --show-origin --get user.name
git config --global --show-origin --get user.email
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
```

Accept an identity only when:

- name and email are both present;
- neither value matches a placeholder;
- the source is understood;
- the identity is consistent with the user's verified configuration.

Do not infer identity from a GitHub login, repository owner, filesystem
username, old commit, or guessed corporate email.

### Repair a placeholder local override

If a local placeholder shadows an already verified global identity:

1. Report the local and global configuration sources.
2. Confirm that the user's request authorizes using the verified global
   identity.
3. Remove only the placeholder local overrides:

```bash
git config --local --unset-all user.name
git config --local --unset-all user.email
```

4. Re-run the identity checks and require the effective source to resolve to
   the verified global configuration.

If no verified real identity exists, stop and ask the user for the exact name
and email. Do not set global configuration without explicit authorization.

Never work around identity validation with:

- `git -c user.name=...` or `git -c user.email=...`;
- `GIT_AUTHOR_*` or `GIT_COMMITTER_*` overrides;
- a temporary placeholder;
- copying an unverified author from history.

## Phase 3: Diagnose repository topology

Inspect:

```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git rev-parse --is-inside-work-tree
git rev-parse --is-bare-repository
git config --show-origin --get core.bare
git rev-parse --verify HEAD
git symbolic-ref --quiet HEAD
git for-each-ref --format='%(refname) %(objectname)' refs/heads refs/tags
```

Before any topology repair, capture:

- HEAD object ID;
- symbolic branch ref, or detached-HEAD state;
- the object ID of the current branch;
- all local head and tag refs;
- upstream ref and current divergence when available;
- current `core.bare` value and configuration source.

### Repair an accidental `core.bare=true`

Treat `core.bare=true` as a diagnosis, not automatic permission to change it.
Changing it is safe only when all of these are established:

- the target is intended to be a normal checkout or linked worktree;
- its `.git` directory or `.git` pointer has a coherent Git directory;
- it is not an intentionally bare/server-side repository;
- HEAD and local refs can be captured before the repair;
- the user requested repair or the repair is a necessary, scoped step of the
  requested worktree operation.

Then change only the repository-local setting:

```bash
git config --local core.bare false
```

Do not edit Git config files by hand.

After the repair, require:

```bash
git rev-parse --is-inside-work-tree
git rev-parse --is-bare-repository
git status --short --branch
git rev-parse --verify HEAD
git symbolic-ref --quiet HEAD
git for-each-ref --format='%(refname) %(objectname)' refs/heads refs/tags
```

The expected topology is `is-inside-work-tree=true` and
`is-bare-repository=false`.

Compare the before and after HEAD, branch ref, local heads, and tags. Report
"no recorded refs moved or disappeared" only when those comparisons match.
Claim "no commits were lost" only with equivalent ref evidence plus any
relevant reflog or reachability proof; never derive that claim from `status`.

## Phase 4: Create or select the worktree

Before creating one:

```bash
git worktree list --porcelain
git branch --list
git show-ref --verify --quiet refs/heads/<branch>
git rev-parse --verify <base-ref>
```

Use an explicit path, branch, and base ref. Follow repository branch naming
rules; in Codex repositories the default prefix is usually `codex/`.

For a new branch:

```bash
git worktree add -b <branch> /absolute/worktree/path <base-ref>
```

For an existing branch:

```bash
git worktree add /absolute/worktree/path <branch>
```

Do not use `--force` to bypass an occupied branch or ambiguous worktree. After
creation, run the full identity and topology preflight inside the new worktree.

## Phase 5: Preserve the change boundary

Before editing:

```bash
git status --short
git diff --stat
git diff --cached --stat
```

After editing:

1. Review the full dirty set.
2. Separate pre-existing changes from task changes.
3. Stage only explicit intended paths.
4. Never use broad staging such as `git add .` or `git add -A` in a dirty tree.
5. Verify the staged boundary:

```bash
git diff --cached --stat
git diff --cached --check
git diff --cached
```

## Phase 6: Verify and commit

Run the task's exact verification command before claiming readiness. Keep
deterministic proof separate from blocked network or environment checks.

Immediately before committing, re-run:

```bash
git branch --show-current
git status --short --branch
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
git diff --cached --check
git diff --cached --stat
```

Stop if the branch is protected, identity is unverified, or the staged set is
broader than authorized.

After an authorized commit:

```bash
git show -s --format=fuller HEAD
git status --short --branch
```

Verify that the recorded author and committer match the validated identity. If
they do not, stop and report it. Do not amend or rewrite the commit unless the
user explicitly authorizes that repair.

## Phase 7: Freshness and publication

Only when fetch or publication is authorized:

```bash
git fetch <remote>
git rev-list --left-right --count HEAD...<remote>/<branch>
git rev-parse HEAD
git rev-parse <remote>/<branch>
```

Measure divergence immediately before any freshness or publication claim.

For an authorized push, name both remote and branch:

```bash
git push <remote> <branch>
```

Then verify the remote-tracking ref and divergence again. A successful command
alone is not proof that the intended commit is published.

## Required closeout

Report:

- repository and worktree path;
- branch and HEAD object ID;
- effective Git author source, without unnecessarily repeating personal data;
- topology result and any local config repair;
- pre-existing changes preserved;
- files staged or committed;
- verification commands and real results;
- commit and push authorization actually exercised;
- upstream divergence and freshness timestamp, if checked;
- exact evidence supporting any "clean", "identical", or "no refs lost" claim;
- incomplete or blocked checks.
