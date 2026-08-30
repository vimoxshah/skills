# Changelog

All notable changes to this project are documented here. Versions follow [semantic versioning](https://semver.org).

## [0.1.2] — 2026-08-30

### Changed
- npm keywords expanded from 8 to 16 to name every harness the installer supports, so a search for `gemini-cli`, `windsurf` or `goose` surfaces the package.

### Added
- `CHANGELOG.md`, shipped inside the npm tarball.
- A skills.sh install badge in the README, and a repository social preview card under `.github/assets/` (not part of the tarball).

## [0.1.1] — 2026-08-30

### Fixed
- Running `npx @vimoxshah/skills` from inside a clone of this repo failed with `command not found: vimoxshah-skills`. npm resolves the spec to the local checkout and looks for the bin in `node_modules/.bin`, which only exists after an `npm install`. It affects the checkout and every subdirectory of it; an unrelated `package.json` in the working directory is fine.

### Added
- `npm start` as the in-clone entry point, plus a README note pointing contributors at `node bin/install.mjs`.
- `THIRD_PARTY.md` now ships inside the npm tarball, so the attribution notices travel with the package.

## [0.1.0] — 2026-08-30

First public release.

### Added
- **10 skills** — `visual-verify`, `html-artifact`, `arxiv`, `claude-router`, `codex-orchestrator`, `design-kit`, `house-decks`, `explain-interface`, `scoped-worktree-delivery`, `eli5`.
- **18 agents** — five model-pinned router lanes (`advisor`, `reviewer`, `hard-implementer`, `implementer`, `explorer`), `paper-analyst`, `presentation-director`, `multi-agent-architect`, and ten specialist advisors adapted from [agency-agents](https://github.com/msitarzewski/agency-agents) (MIT).
- **Multi-harness installer** covering Claude Code, Codex, Cursor, OpenCode, Copilot, Gemini CLI, Goose, Amp, Factory, Kiro, Windsurf, Cline and Roo. Skills symlink from one central clone so every harness reads the same files and `update` is a single `git pull`; agents transpile to each harness's native format.
- `doctor`, `uninstall`, `list` and `update` subcommands. The installer never overwrites a real directory, records a receipt of every path it creates, and reverses cleanly.
- Claude Code plugin marketplace manifest, a bash fallback installer, and CI that lints frontmatter, bundle membership, and machine-specific leakage.
