# skills

**Skills and agents for AI coding assistants — Claude Code, Codex, Cursor, OpenCode, Copilot, Gemini CLI and more. One install, every harness.**

[![MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-✓-d97757)](#works-with)
[![Codex](https://img.shields.io/badge/Codex-✓-10b981)](#works-with)
[![Cursor](https://img.shields.io/badge/Cursor-✓-000)](#works-with)
[![OpenCode](https://img.shields.io/badge/OpenCode-✓-3b82f6)](#works-with)
[![Lint](https://github.com/vimoxshah/skills/actions/workflows/lint.yml/badge.svg)](https://github.com/vimoxshah/skills/actions/workflows/lint.yml)

A skill is a folder with a `SKILL.md` that teaches an agent how to do one job well. An agent is a subagent definition with its own model, tools, and conduct. This repo holds the ones I use every day: verify visual output before calling it done, publish a page that survives being shared, turn arXiv papers into a decision, route each task to the cheapest model that can do it, build decks and themes that look like one system.

## Install

Pick one. All three land in the same place and can be re-run safely.

```bash
# 1 · The standard way (works for ~20 harnesses, interactive picker)
npx skills add vimoxshah/skills

# 2 · This repo's installer — detects your harnesses, asks what to link, symlinks from one central clone
npx github:vimoxshah/skills

# 3 · No Node? Same thing in bash
curl -fsSL https://raw.githubusercontent.com/vimoxshah/skills/main/install.sh | bash
```

Claude Code users can also install it as a plugin:

```
/plugin marketplace add vimoxshah/skills
/plugin install skills@vimoxshah
```

Want just one skill? `npx skills add vimoxshah/skills --skill visual-verify`

Non-interactive (CI, dotfiles): `npx github:vimoxshah/skills --yes --all`

## What's inside

### Skills

| Skill | What it does |
| --- | --- |
| **`visual-verify`** | Render the page, chart, diagram, or deck and *look* at it before reporting it works. Covers the animation-settle trap and three verification tiers. |
| **`html-artifact`** | Build single-file HTML pages that survive being shared: no network, light + dark that honours the viewer's toggle, deck shells, SVG diagrams, a pre-publish check. |
| **`arxiv`** | Turn arXiv research into a decision for the repo you are in — sweep a category, deep-read one paper's LaTeX, or map a corpus onto the codebase. Citation-gated: no figure is ever paraphrased into existence. |
| **`claude-router`** | Route each task to the right Claude tier — Fable for judgment, Opus to orchestrate and review, Sonnet to build, Haiku for volume — via model-pinned subagents. |
| **`codex-orchestrator`** | Claude plans and verifies; Codex executes. Bounded work packets, three Codex profiles, an escalation path. |
| **`design-kit`** | One token registry for every surface: 11 themes × 9 font pairings validated as a pair, a font pipeline with a license manifest, motion tokens, chart ramps. Compiles to decks, HTML artifacts, video frames, and pptx. |
| **`house-decks`** | A self-contained 1920×1080 HTML deck system: keyboard nav, presenter window with speaker notes, print-to-PDF variant, reveal/pop/terminal animations, and a narrative guide for picking the arc. |
| **`explain-interface`** | "How was this built?" — give it a URL and the thing you're curious about; it reads the layers that produce the effect and explains each one. |
| **`scoped-worktree-delivery`** | Git worktrees done safely: prove the topology, verify author identity, isolate the change, publish only when authorized. |
| **`eli5`** | `/eli5 <topic>` — a dead-simple picture explainer as an HTML artifact. |

### Agents

Model-pinned lanes the router dispatches, plus specialist advisors.

| Agent | Model | Role |
| --- | --- | --- |
| `advisor` | Fable | Read-only judgment at commitment boundaries — architecture, migrations, contracts. |
| `reviewer` | Opus | Read-only diff review and synthesis; hunts weakened tests and planted shortcuts. |
| `hard-implementer` | Opus | The write lane for hard-as-code changes and root-cause debugging. |
| `implementer` | Sonnet | The everyday build lane; writes code and proves it with tests. |
| `explorer` | Haiku | Fast read-only fan-out: locate, map, summarise. |
| `paper-analyst` | Opus | Deep-reads one arXiv paper's LaTeX and returns a typed relevance verdict. |
| `presentation-director` | Opus | Takes "I need to present X to Y in N minutes" and delivers the finished piece. |
| `multi-agent-architect` | Sonnet | Topology, trust, failure recovery, and HITL gating for multi-agent systems. |
| `statistician` · `technical-writer` · `ux-architect` · `brand-guardian` · `content-creator` · `developer-advocate` · `database-optimizer` · `identity-access-engineer` · `search-relevance-engineer` · `persona-walkthrough` | Sonnet | Specialist advisors. Adapted from [agency-agents](https://github.com/msitarzewski/agency-agents) (MIT). |

### Claude Code extras

`/style` picks an output style from a popup; two styles ship (`attention-kind` — ADHD-friendly, front-loaded; `plain` — answer first, warm, short); a statusline script showing model, effort, context used, and cost; the two routing policies (`CLAUDE-ROUTING.md`, `CLAUDE-CODEX-ROUTING.md`).

`rules/context7.md` is a standing rule that sends library and API questions to live documentation instead of training data. The installer does not edit your `CLAUDE.md` — add it yourself with `@rules/context7.md` if you want it.

## Works with

| Harness | Skills | Agents |
| --- | --- | --- |
| Claude Code | `~/.claude/skills` | `~/.claude/agents` (native) |
| OpenAI Codex CLI | `~/.agents/skills` | `~/.codex/agents/*.toml` (transpiled) |
| Cursor | `~/.cursor/skills` | `~/.cursor/agents` (transpiled) |
| OpenCode | `~/.config/opencode/skills` | `~/.config/opencode/agent` (transpiled) |
| GitHub Copilot CLI | `~/.copilot/skills` | installed as skills |
| Gemini CLI | `~/.gemini/skills` | installed as skills |
| Goose · Amp · Factory · Kiro · Windsurf · Cline · Roo | their skills dir | installed as skills |

Paths come from [`harnesses.json`](harnesses.json). If your harness is missing, add a row there and open a PR.

## How the install works

```
~/.agents/vimoxshah-skills/          ← one shallow clone (the central place)
   ├── skills/visual-verify/
   └── agents/reviewer.md

~/.claude/skills/visual-verify  →  symlink into the clone
~/.cursor/skills/visual-verify  →  symlink into the clone
~/.codex/agents/reviewer.toml   ←  copy, transpiled to Codex's format
```

- **One copy on disk.** Every harness reads the same files. `update` is a `git pull`; the links stay valid.
- **Never clobbers.** A real directory in the way is skipped with a warning, not replaced. Your edited routing policy is never overwritten.
- **Reversible.** A receipt records every path created; `uninstall` removes exactly those.
- **Windows** defaults to copy (symlinks need Developer Mode).

```bash
npx github:vimoxshah/skills update      # pull the latest
npx github:vimoxshah/skills doctor      # broken links, drift, unwired harnesses
npx github:vimoxshah/skills uninstall   # remove everything the installer created
npx github:vimoxshah/skills list        # what's in each bundle
```

Bundles: `core` · `routing` · `research` · `design` · `experts` · `claude-extras`. Defined in [`manifest.json`](manifest.json).

## Skill format

Each skill follows the [Agent Skills](https://agentskills.io) spec — a directory with a `SKILL.md` whose frontmatter carries `name` and `description`, plus any scripts or references the skill loads on demand. That is why `npx skills add` works with no code from this repo.

```
skills/visual-verify/
├── SKILL.md          # name, description, the instructions
└── scripts/          # optional helpers the skill calls
```

## Contributing

Issues and PRs welcome. Run `node scripts/lint.mjs` before pushing — it checks frontmatter, bundle membership, and that nothing machine-specific leaked in. Keep a skill to one job; if it needs a second `SKILL.md`, it is two skills.

## License

MIT © Vimox Shah. Third-party notices in [`THIRD_PARTY.md`](THIRD_PARTY.md).
