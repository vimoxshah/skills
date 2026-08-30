#!/bin/sh
input=$(cat)

# ---- extract fields ----------------------------------------------------------
model=$(echo "$input"       | jq -r '.model.display_name // "Unknown Model"')
model_id=$(echo "$input"    | jq -r '.model.id // empty')
version=$(echo "$input"     | jq -r '.version // empty')
effort=$(echo "$input"      | jq -r '.effort.level // empty')
fast_mode=$(echo "$input"   | jq -r '.fast_mode // false')
thinking=$(echo "$input"    | jq -r '.thinking.enabled // false')
style=$(echo "$input"       | jq -r '.output_style.name // empty')
session_name=$(echo "$input" | jq -r '.session_name // empty')
used=$(echo "$input"        | jq -r '.context_window.used_percentage // empty')
ctx_tokens=$(echo "$input"  | jq -r '.context_window.total_input_tokens // empty')
ctx_window=$(echo "$input"  | jq -r '.context_window.context_window_size // empty')
worktree=$(echo "$input"    | jq -r '.worktree.name // empty')
total_cost=$(echo "$input"  | jq -r '.cost.total_cost_usd // empty')
dur_ms=$(echo "$input"      | jq -r '.cost.total_duration_ms // empty')
lines_add=$(echo "$input"   | jq -r '.cost.total_lines_added // empty')
lines_del=$(echo "$input"   | jq -r '.cost.total_lines_removed // empty')
current_dir=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // .worktree.original_cwd // empty')

# rate limits — round percentages to integers (bar math + [ -ge ] need ints)
rl_5h_pct=$(echo "$input"   | jq -r '.rate_limits.five_hour.used_percentage // empty'  | awk 'NF{printf "%.0f",$1}')
rl_5h_reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
rl_7d_pct=$(echo "$input"   | jq -r '.rate_limits.seven_day.used_percentage // empty'  | awk 'NF{printf "%.0f",$1}')
rl_7d_reset=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

# NOTE: Claude Code exposes only these two AGGREGATE buckets (all models combined).
# There is no per-model (Opus/Sonnet/Fable) rate-limit field in the payload.

# ---- account + org (whichever config the active account actually lives in) ---
# Multi-account layouts differ: a custom account puts its identity in
# $CLAUDE_CONFIG_DIR/.claude.json; the DEFAULT account's identity lives in
# ~/.claude.json (while ~/.claude/.claude.json may exist but hold no account).
# So we try candidates in priority order and take the FIRST that yields an
# email — not merely the first file that exists.
account=""; org=""
_try_acct() {
  [ -n "$account" ] && return           # already resolved
  f="$1"; [ -f "$f" ] || return
  e=$(grep -o '"emailAddress"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
  [ -z "$e" ] && e=$(jq -r '.oauthAccount.emailAddress // empty' "$f" 2>/dev/null)
  [ -z "$e" ] && return
  account="$e"
  org=$(grep -o '"organizationName"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
  [ -z "$org" ] && org=$(jq -r '.oauthAccount.organizationName // empty' "$f" 2>/dev/null)
}
[ -n "$CLAUDE_CONFIG_DIR" ] && _try_acct "$CLAUDE_CONFIG_DIR/.claude.json"
_try_acct "$HOME/.claude.json"
_try_acct "$HOME/.claude/.claude.json"

# ---- palette (real ESC bytes; NO dim — every element is clearly visible) -----
ESC=$(printf '\033')
RESET="${ESC}[0m"
GREEN="${ESC}[32m"; YELLOW="${ESC}[33m"; RED="${ESC}[31m"   # usage health (reserved)
ACCT="${ESC}[1;96m"   # bold bright-cyan — account name
DOMAIN="${ESC}[36m"   # cyan — email domain
ORGC="${ESC}[95m"     # bright magenta — org
VERC="${ESC}[94m"     # bright blue — version / style
DURC="${ESC}[96m"     # bright cyan — duration
NAMEC="${ESC}[97m"    # bright white — session name
MUTE="${ESC}[90m"     # gray — token counts / separators / parentheticals

now=$(date +%s)

# ---- helpers -----------------------------------------------------------------
to_epoch() {
  v="$1"; [ -z "$v" ] && return
  case "$v" in
    *[!0-9]*)
      date -d "$v" +%s 2>/dev/null || \
      date -j -f "%Y-%m-%dT%H:%M:%S" "$(echo "$v" | sed 's/\..*//; s/[Zz].*$//; s/[+-][0-9][0-9]:[0-9][0-9]$//')" +%s 2>/dev/null
      ;;
    *) printf "%s" "$v" ;;
  esac
}

# epoch -> smart absolute clock: "3:45PM" today, "Fri 7:50PM" this week, "Jul 23 11:04PM" beyond
fmt_reset() {
  ep="$1"; [ -z "$ep" ] && return
  today=$(date "+%Y%m%d")
  rday=$(date -r "$ep" "+%Y%m%d" 2>/dev/null || date -d "@$ep" "+%Y%m%d" 2>/dev/null)
  diff=$(( ep - now ))
  if [ "$rday" = "$today" ]; then
    date -r "$ep" "+%-I:%M%p" 2>/dev/null || date -d "@$ep" "+%-I:%M%p" 2>/dev/null
  elif [ "$diff" -gt 0 ] && [ "$diff" -lt 604800 ]; then
    date -r "$ep" "+%a %-I:%M%p" 2>/dev/null || date -d "@$ep" "+%a %-I:%M%p" 2>/dev/null
  else
    date -r "$ep" "+%b %-d %-I:%M%p" 2>/dev/null || date -d "@$ep" "+%b %-d %-I:%M%p" 2>/dev/null
  fi
}

human_delta() {
  s="$1"
  { [ -z "$s" ] || [ "$s" -le 0 ] 2>/dev/null; } && { printf "0s"; return; }
  d=$(( s / 86400 )); h=$(( (s % 86400) / 3600 )); m=$(( (s % 3600) / 60 )); sec=$(( s % 60 ))
  if [ "$d" -gt 0 ]; then
    [ "$h" -gt 0 ] && printf "%dd%dh" "$d" "$h" || printf "%dd" "$d"
  elif [ "$h" -gt 0 ]; then printf "%dh%02dm" "$h" "$m"
  elif [ "$m" -gt 0 ]; then printf "%dm" "$m"
  else printf "%ds" "$sec"; fi
}

# token count -> 1M / 193k / 512
tokh() {
  t="${1:-0}"
  if   [ "$t" -ge 1000000 ]; then awk -v x="$t" 'BEGIN{ v=x/1000000; if (v==int(v)) printf "%dM",v; else printf "%.1fM",v }'
  elif [ "$t" -ge 1000 ];    then printf "%dk" "$(( (t + 500) / 1000 ))"
  else printf "%d" "$t"; fi
}

# truncate a string to N chars with an ellipsis
trunc() {
  s="$1"; max="${2:-24}"
  if [ "$(printf '%s' "$s" | wc -c | tr -d ' ')" -gt "$max" ]; then
    printf '%s…' "$(printf '%s' "$s" | cut -c1-"$max")"
  else
    printf '%s' "$s"
  fi
}

pct_color() {
  p="${1:-0}"
  if   [ "$p" -ge 90 ]; then printf "%s" "$RED"
  elif [ "$p" -ge 70 ]; then printf "%s" "$YELLOW"
  else                       printf "%s" "$GREEN"; fi
}

make_bar() {
  pct="${1:-0}"; width=10
  filled=$(( pct * width / 100 ))
  [ "$filled" -gt "$width" ] && filled=$width
  [ "$filled" -lt 0 ] && filled=0
  bar=""; i=0
  while [ "$i" -lt "$filled" ]; do bar="${bar}█"; i=$(( i + 1 )); done
  while [ "$i" -lt "$width" ];  do bar="${bar}░"; i=$(( i + 1 )); done
  printf "%s" "$bar"
}

format_rl() {
  pct="$1"; reset_raw="$2"; label="$3"
  [ -z "$pct" ] && return
  color=$(pct_color "$pct"); bar=$(make_bar "$pct")
  reset_ep=$(to_epoch "$reset_raw"); at=""
  [ -n "$reset_ep" ] && at=$(fmt_reset "$reset_ep")
  if [ -n "$at" ]; then
    printf "%s%s %s %s%% ↻%s%s" "$color" "$label" "$bar" "$pct" "$at" "$RESET"
  else
    printf "%s%s %s %s%%%s" "$color" "$label" "$bar" "$pct" "$RESET"
  fi
}

# ---- LINE 1: identity — model (+flags), account, org, version ---------------
model_clean=$(printf '%s' "$model" | sed -E 's/ *\(1M context\)//I')
badge=""
case "$model_id$model" in *1m*|*1M*|*'[1m]'*) badge="${MUTE}·1M${RESET}" ;; esac
flags=""
[ "$fast_mode" = "true" ] && flags="$flags ⚡"      # only shown when fast mode is on
[ "$thinking" = "true" ]  && flags="$flags 💭"      # extended thinking active
line1="🤖 ${model_clean}${badge}${flags}"

if [ -n "$account" ]; then
  case "$account" in
    *@*) acct_local="${account%%@*}"; acct_domain="${account#*@}"
         line1="$line1 | $(printf "👤 %s%s%s%s@%s%s" "$ACCT" "$acct_local" "$RESET" "$DOMAIN" "$acct_domain" "$RESET")" ;;
    *)   line1="$line1 | $(printf "👤 %s%s%s" "$ACCT" "$account" "$RESET")" ;;
  esac
fi
[ -n "$org" ]     && line1="$line1 | $(printf "🏢 %s%s%s" "$ORGC" "$org" "$RESET")"
[ -n "$version" ] && line1="$line1 | $(printf "📟 %sv%s%s" "$VERC" "$version" "$RESET")"

# ---- LINE 2: live work — effort, style, context, cost+burn, churn, duration --
line2=""
[ -n "$effort" ] && line2="💪 $effort"
# output style only when it isn't the default
case "$style" in ""|default) : ;; *) seg=$(printf "🎨 %s%s%s" "$VERC" "$style" "$RESET"); [ -n "$line2" ] && line2="$line2 | $seg" || line2="$seg" ;; esac

# context: colored % + actual tokens / window size
if [ -n "$used" ]; then
  used_i=$(printf "%.0f" "$used")
  ctx_str=$(printf "🧠 %s%s%%%s" "$(pct_color "$used_i")" "$used_i" "$RESET")
  if [ -n "$ctx_tokens" ] && [ -n "$ctx_window" ]; then
    ctx_str="$ctx_str $(printf "%s(%s/%s)%s" "$MUTE" "$(tokh "$ctx_tokens")" "$(tokh "$ctx_window")" "$RESET")"
  fi
else
  ctx_str="🧠 0%"
fi
[ -n "$line2" ] && line2="$line2 | $ctx_str" || line2="$ctx_str"

if [ -n "$total_cost" ]; then
  cost_fmt=$(awk -v c="$total_cost" 'BEGIN { printf "%.2f", c }')
  cost_str="💰 \$$cost_fmt"
  if [ -n "$dur_ms" ] && [ "$dur_ms" -ge 300000 ] 2>/dev/null; then
    burn=$(awk -v c="$total_cost" -v d="$dur_ms" 'BEGIN { if (d > 0) printf "%.2f", c / (d / 3600000); else printf "0" }')
    case "$burn" in 0|0.00) : ;; *) cost_str="$cost_str $(printf "%s(\$%s/h)%s" "$MUTE" "$burn" "$RESET")" ;; esac
  fi
  line2="$line2 | $cost_str"
fi

la=${lines_add:-0}; ld=${lines_del:-0}
if { [ "$la" -gt 0 ] 2>/dev/null; } || { [ "$ld" -gt 0 ] 2>/dev/null; }; then
  line2="$line2 | $(printf "✏️ %s+%s%s/%s-%s%s" "$GREEN" "$la" "$RESET" "$RED" "$ld" "$RESET")"
fi

if [ -n "$dur_ms" ]; then
  dur_s=$(( dur_ms / 1000 ))
  [ "$dur_s" -gt 0 ] && line2="$line2 | $(printf "⏱️ %s%s%s" "$DURC" "$(human_delta "$dur_s")" "$RESET")"
fi

# ---- LINE 3: rate limits -----------------------------------------------------
r5=$(format_rl "$rl_5h_pct" "$rl_5h_reset" "5h")
r7=$(format_rl "$rl_7d_pct" "$rl_7d_reset" "7d")
line3=""
if [ -n "$r5" ] || [ -n "$r7" ]; then
  line3="⌛ "
  [ -n "$r5" ] && line3="${line3}${r5}"
  if [ -n "$r7" ]; then
    [ -n "$r5" ] && line3="${line3}  ${MUTE}·${RESET}  "
    line3="${line3}${r7}"
  fi
fi

# ---- LINE 4: session name + location -----------------------------------------
gitdir="${current_dir:-.}"
if git -C "$gitdir" rev-parse --git-dir > /dev/null 2>&1; then
  branch=$(git -C "$gitdir" branch --show-current 2>/dev/null)
  [ -z "$branch" ] && branch=$(git -C "$gitdir" rev-parse --abbrev-ref HEAD 2>/dev/null)
  staged=$(git -C "$gitdir" diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
  modified=$(git -C "$gitdir" diff --numstat 2>/dev/null | wc -l | tr -d ' ')
  git_str="$branch"
  [ "$staged" -gt 0 ]   && git_str=$(printf "%s %s+%s%s" "$git_str" "$GREEN" "$staged" "$RESET")
  [ "$modified" -gt 0 ] && git_str=$(printf "%s %s~%s%s" "$git_str" "$YELLOW" "$modified" "$RESET")
else
  git_str="no branch"
fi

repo_root=$(git -C "${current_dir:-.}" rev-parse --show-toplevel 2>/dev/null || echo "${current_dir:-$PWD}")
dir_display=$(basename "$repo_root")
[ -n "$worktree" ] && worktree_str="$worktree" || worktree_str="no worktree"

line4=""
[ -n "$session_name" ] && line4="$(printf "📌 %s%s%s" "$NAMEC" "$(trunc "$session_name" 28)" "$RESET") | "
line4="${line4}📁 $dir_display | 🌳 $worktree_str | 🌿 $git_str"

# ---- emit (skip empty lines) -------------------------------------------------
# line1 (identity) + line2 (live work) are merged onto a single row
out="$line1 | $line2"
[ -n "$line3" ] && out="$out
$line3"
out="$out
$line4"
printf "%s" "$out"
