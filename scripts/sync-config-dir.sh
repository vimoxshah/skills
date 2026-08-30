#!/usr/bin/env bash
#
# sync-config-dir.sh — give an alternate CLAUDE_CONFIG_DIR the same customization
# as ~/.claude, without duplicating a single file.
#
# WHY THIS EXISTS
# Claude Code reads customization (agents, skills, commands, output styles, MCP
# config) from $CLAUDE_CONFIG_DIR, defaulting to ~/.claude. When a session runs with
# CLAUDE_CONFIG_DIR pointed elsewhere — child sessions and some harnesses do this —
# everything in ~/.claude becomes invisible. The failure is silent: agents simply are
# not in the Agent tool's roster, skills never appear for auto-selection, and nothing
# reports an error. On 2026-08-27 that cost a debugging session: 18 valid agent files,
# five of them the claude-router lanes, none dispatchable, no diagnostic.
#
# WHAT IT DOES
# Symlinks the customization directories from ~/.claude into the target config dir, so
# there is exactly one copy of every agent, skill, and command on disk. Merges
# settings.json, letting the target's own keys win. Never touches runtime state.
#
#   ./sync-config-dir.sh                    # sync $CLAUDE_CONFIG_DIR (or report if unset)
#   ./sync-config-dir.sh ~/.claude-alt       # sync a specific dir
#   ./sync-config-dir.sh --check ~/.claude-alt   # report drift, change nothing
#
# Idempotent. Re-run it any time, and after adding a new config dir.

set -uo pipefail

SOURCE="$HOME/.claude"
CHECK=0
TARGET=""

for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) TARGET="${arg/#\~/$HOME}" ;;
  esac
done

[ -n "$TARGET" ] || TARGET="${CLAUDE_CONFIG_DIR:-}"
if [ -z "$TARGET" ]; then
  echo "CLAUDE_CONFIG_DIR is unset, so this session already reads $SOURCE directly."
  echo "Nothing to sync. Pass a directory explicitly to prepare one in advance."
  exit 0
fi
if [ "$TARGET" = "$SOURCE" ]; then
  echo "Target is $SOURCE itself — nothing to sync."
  exit 0
fi
[ -d "$SOURCE" ] || { echo "source $SOURCE does not exist" >&2; exit 1; }
mkdir -p "$TARGET"

# Customization: shared by symlink, so one edit in ~/.claude reaches every config dir.
LINKS=(
  agents                      # subagent definitions — the claude-router lanes live here
  skills                      # skills, incl. claude-router; absent = never auto-selected
  commands                    # slash commands
  output-styles               # referenced by the outputStyle setting
  hooks                       # hook scripts (settings uses absolute paths, but be complete)
  scripts                     # helper scripts, incl. this one
  rules                       # rule files @imported by CLAUDE.md
  CLAUDE-ROUTING.md           # claude-router policy — the skill reads this
  CLAUDE-CODEX-ROUTING.md     # codex-orchestrator policy (separate mechanism)
  .mcp.json                   # MCP server definitions
  statusline-command.sh       # statusline
)

# Deliberately NOT linked.
#   CLAUDE.md / RTK.md  — user memory already loads from ~/.claude regardless of the
#                         config dir; linking them again double-loads the instructions.
#   plugins             — part install state, part cache, and the two dirs legitimately
#                         differ. Use `claude plugin` in the target dir instead.
#   projects sessions history.jsonl backups cache file-history paste-cache
#   shell-snapshots session-env image-cache .claude.json policy-limits.json
#   remote-settings.json .credentials.json
#                       — per-config-dir runtime state. Sharing it merges unrelated
#                         session histories and can corrupt them.

changed=0
report() { printf '  %-26s %s\n' "$1" "$2"; }

for entry in "${LINKS[@]}"; do
  src="$SOURCE/$entry"
  dst="$TARGET/$entry"
  [ -e "$src" ] || { report "$entry" "skipped (not in source)"; continue; }

  if [ -L "$dst" ]; then
    current="$(readlink "$dst")"
    if [ "$current" = "$src" ]; then report "$entry" "ok (already linked)"; continue; fi
    if [ "$CHECK" = 1 ]; then report "$entry" "DRIFT → $current"; changed=1; continue; fi
    rm "$dst"; ln -s "$src" "$dst"; report "$entry" "relinked (was → $current)"; changed=1
  elif [ -e "$dst" ]; then
    # A real file/dir is present. Never clobber silently.
    if [ "$CHECK" = 1 ]; then report "$entry" "CONFLICT (real file exists)"; changed=1; continue; fi
    mv "$dst" "$dst.pre-sync.bak"; ln -s "$src" "$dst"
    report "$entry" "linked (existing moved to $entry.pre-sync.bak)"; changed=1
  else
    if [ "$CHECK" = 1 ]; then report "$entry" "MISSING"; changed=1; continue; fi
    ln -s "$src" "$dst"; report "$entry" "linked"; changed=1
  fi
done

# settings.json: merge rather than link. The target's own keys are intentional choices
# for that context (effort level, TUI mode) and must survive; everything else — hooks,
# permissions, plugins, statusline — comes from the source.
echo
if [ -f "$SOURCE/settings.json" ]; then
  python3 - "$SOURCE/settings.json" "$TARGET/settings.json" "$CHECK" <<'PY'
import json, sys, os, shutil
src_p, dst_p, check = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
src = json.load(open(src_p))
dst = json.load(open(dst_p)) if os.path.exists(dst_p) else {}

# plugins/ is intentionally NOT shared (part install state, part cache, and the two dirs
# legitimately differ), so do not carry over settings that claim plugins this config dir
# has not installed — that produces load errors for marketplaces it cannot see.
NOT_PORTABLE = {"enabledPlugins", "extraKnownMarketplaces"}
src = {k: v for k, v in src.items() if k not in NOT_PORTABLE}

merged = {**src, **dst}          # target keys win — they are deliberate local overrides
if merged == dst:
    print("  settings.json              ok (already a superset)")
elif check:
    added = sorted(set(merged) - set(dst))
    print(f"  settings.json              DRIFT — would add: {', '.join(added)}")
else:
    if os.path.exists(dst_p):
        shutil.copy2(dst_p, dst_p + ".pre-sync.bak")
    tmp = dst_p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(merged, f, indent=2)
        f.write("\n")
    json.load(open(tmp))         # never install invalid JSON
    os.replace(tmp, dst_p)
    added = sorted(set(merged) - set(dst))
    kept = sorted(set(dst) & set(src))
    print(f"  settings.json              merged (+{len(added)} keys, {len(kept)} local override(s) kept)")
    if added: print(f"                             added: {', '.join(added)}")
    if kept:  print(f"                             kept local: {', '.join(kept)}")
PY
fi

echo
if [ "$CHECK" = 1 ]; then
  [ "$changed" = 0 ] && echo "$TARGET is in sync." || echo "$TARGET has drift (see above). Re-run without --check to fix."
  exit "$changed"
fi
echo "Synced $TARGET → $SOURCE"
echo
echo "Verify the agents actually registered — file validity is not registration:"
echo "  cd /tmp && claude -p 'List every subagent_type value available, one per line.' < /dev/null"
