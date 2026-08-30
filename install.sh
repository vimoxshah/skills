#!/usr/bin/env bash
#
# vimoxshah/skills - one-line installer
#
#   curl -fsSL https://raw.githubusercontent.com/vimoxshah/skills/main/install.sh | bash
#
# Non-interactive by design. It clones (or pulls) the central checkout and then
# hands over to bin/install.mjs when Node >= 18 is there. The pure-bash path
# below is the fallback for machines without Node: it symlinks every skill into
# every detected harness plus the universal root, and copies the Claude extras.
#
# Environment
#   SKILLS_HARNESSES="claude,codex"   wire only these (default: all detected)
#   SKILLS_COPY=1                     copy instead of symlink
#   SKILLS_DIR=/path                  central checkout (default below)
#
# Never-clobber rule, in both paths: a real file or directory in the way is
# left alone, and the only symlink ever replaced is one that already points
# into the central checkout.

set -eu

REPO_URL="https://github.com/vimoxshah/skills"
# manifest.json holds centralDir; it is mirrored here because this path has to
# work before Node (and therefore before any JSON parsing) is available.
CENTRAL="${SKILLS_DIR:-$HOME/.agents/vimoxshah-skills}"
COPY="${SKILLS_COPY:-0}"
UNIVERSAL=".agents/skills"

DONE=0
SKIPPED=0
ALREADY=0
CLAUDE_ON=0

say() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
short() {
  case "$1" in
    "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# ---------------------------------------------------------------- the checkout

if [ -d "$CENTRAL/.git" ]; then
  say "pull   $(short "$CENTRAL")"
  git -C "$CENTRAL" pull --ff-only >/dev/null 2>&1 || say "warn   git pull --ff-only failed - using what is on disk"
elif [ -f "$CENTRAL/manifest.json" ]; then
  say "central $(short "$CENTRAL")  (not our clone, left alone)"
else
  if ! have git; then
    say "install.sh needs git. Install git, or clone by hand:"
    say "  git clone --depth 1 $REPO_URL $CENTRAL"
    exit 1
  fi
  say "clone  $REPO_URL -> $(short "$CENTRAL")"
  mkdir -p "$(dirname "$CENTRAL")"
  git clone --depth 1 "$REPO_URL" "$CENTRAL"
fi

# ------------------------------------------------------- hand over to the mjs

node_major=0
if have node; then
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
fi
case "$node_major" in
  '' | *[!0-9]*) node_major=0 ;;
esac

if [ "$node_major" -ge 18 ]; then
  say "node   v$node_major - handing over to bin/install.mjs"
  # An array, so a home directory with a space in it still works.
  args=(--yes --dir "$CENTRAL")
  if [ "$COPY" = "1" ]; then args+=(--copy); fi
  if [ -n "${SKILLS_HARNESSES:-}" ]; then args+=(--harness "$SKILLS_HARNESSES"); fi
  exec node "$CENTRAL/bin/install.mjs" "${args[@]}" ${1+"$@"}
fi

say "note   node >= 18 not found - using the pure-bash path (skills and Claude extras only)"

# --------------------------------------------------------------- the bash path

place() { # place <source> <destination> - symlink, or copy when SKILLS_COPY=1
  src="$1"
  dest="$2"
  if [ -L "$dest" ]; then
    target="$(readlink "$dest")"
    if [ "$target" = "$src" ]; then
      ALREADY=$((ALREADY + 1))
      return 0
    fi
    case "$target" in
      "$CENTRAL"/*) rm -f "$dest" ;;
      *)
        say "skip   $(short "$dest")  (a symlink we did not make)"
        SKIPPED=$((SKIPPED + 1))
        return 0
        ;;
    esac
  elif [ -e "$dest" ]; then
    say "skip   $(short "$dest")  (already there and not ours)"
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  if [ "$COPY" = "1" ]; then
    cp -R "$src" "$dest"
    say "copy   $(short "$dest")"
  else
    ln -s "$src" "$dest"
    say "link   $(short "$dest") -> $(short "$src")"
  fi
  DONE=$((DONE + 1))
}

copy_if_absent() { # copy_if_absent <source file> <destination file>
  src="$1"
  dest="$2"
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    ALREADY=$((ALREADY + 1))
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  say "copy   $(short "$dest")"
  DONE=$((DONE + 1))
}

link_all_skills() { # link_all_skills <skills dir, relative to HOME>
  for src in "$CENTRAL"/skills/*/; do
    [ -d "$src" ] || continue
    src="${src%/}"
    place "$src" "$HOME/$1/$(basename "$src")"
  done
}

selection() { # selection <harness id> -> yes | no | auto
  if [ -z "${SKILLS_HARNESSES:-}" ]; then
    printf 'auto' # no override, so fall back to detection
    return 0
  fi
  case ",${SKILLS_HARNESSES}," in
    *",$1,"*) printf 'yes' ;;
    *) printf 'no' ;;
  esac
}

detected() { # detected <comma separated detect paths>
  old_ifs="$IFS"
  IFS=,
  for d in $1; do
    if [ -e "$HOME/$d" ]; then
      IFS="$old_ifs"
      return 0
    fi
  done
  IFS="$old_ifs"
  return 1
}

# id|detect paths|skills dir  - mirrors harnesses.json, which stays the source
# of truth for the Node installer.
while IFS='|' read -r hid detects skills_dir; do
  [ -n "$hid" ] || continue
  case "$(selection "$hid")" in
    no) continue ;;                          # SKILLS_HARNESSES leaves it out
    yes) ;;                                  # named, so wire it either way
    *) detected "$detects" || continue ;;    # auto: only if the harness is here
  esac
  [ "$hid" = "claude" ] && CLAUDE_ON=1
  say "harness $hid -> $(short "$HOME/$skills_dir")"
  link_all_skills "$skills_dir"
done <<'TABLE'
claude|.claude|.claude/skills
codex|.codex|.agents/skills
cursor|.cursor|.cursor/skills
opencode|.config/opencode,.opencode|.config/opencode/skills
copilot|.copilot|.copilot/skills
gemini|.gemini|.gemini/skills
goose|.config/goose|.config/goose/skills
amp|.config/amp,.amp|.agents/skills
factory|.factory|.factory/skills
kiro|.kiro|.kiro/skills
windsurf|.codeium/windsurf,.windsurf|.codeium/windsurf/skills
cline|.cline|.cline/skills
roo|.roo|.roo/skills
TABLE

# The cross-tool root always gets the skills: several harnesses read it directly.
say "harness universal -> $(short "$HOME/$UNIVERSAL")"
link_all_skills "$UNIVERSAL"

# Claude extras: copied, never overwritten. Agents stay in their native format.
if [ "$CLAUDE_ON" = "1" ] && [ -d "$HOME/.claude" ]; then
  say "harness claude extras -> $(short "$HOME/.claude")"
  for f in "$CENTRAL"/agents/*.md; do
    [ -f "$f" ] || continue
    copy_if_absent "$f" "$HOME/.claude/agents/$(basename "$f")"
  done
  for f in "$CENTRAL"/commands/*.md; do
    [ -f "$f" ] || continue
    copy_if_absent "$f" "$HOME/.claude/commands/$(basename "$f")"
  done
  for f in "$CENTRAL"/output-styles/*.md; do
    [ -f "$f" ] || continue
    copy_if_absent "$f" "$HOME/.claude/output-styles/$(basename "$f")"
  done
fi

say ""
say "$DONE installed - $ALREADY already there - $SKIPPED left alone"
say ""
say "Next steps"
say "  - Restart your harness (or open a new session) to pick up the new skills."
say "  - Copies are never overwritten here. Install Node >= 18 and re-run for"
say "    updates, bundle choice and agent transpiling:"
say "      node $(short "$CENTRAL")/bin/install.mjs"
say "  - Claude Code alternative:  /plugin marketplace add vimoxshah/skills"
say "  - Universal alternative:    npx skills add vimoxshah/skills"
