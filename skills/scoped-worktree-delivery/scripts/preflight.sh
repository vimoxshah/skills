#!/usr/bin/env bash

set -u

delivery_repo="${1:-.}"

if ! cd "$delivery_repo" 2>/dev/null; then
  printf 'ERROR target path is not accessible: %s\n' "$delivery_repo" >&2
  exit 3
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  printf 'ERROR target is not a Git repository: %s\n' "$delivery_repo" >&2
  exit 3
fi

delivery_name="$(git config --get user.name 2>/dev/null || true)"
delivery_email="$(git config --get user.email 2>/dev/null || true)"
delivery_name_lower="$(printf '%s' "$delivery_name" | tr '[:upper:]' '[:lower:]')"
delivery_email_lower="$(printf '%s' "$delivery_email" | tr '[:upper:]' '[:lower:]')"
delivery_identity_bad=0

case "$delivery_name_lower" in
  ""|"t"|"test"|"test user"|"your name"|"user"|"codex")
    delivery_identity_bad=1
    ;;
esac

case "$delivery_email_lower" in
  ""|"t@t"|"t@t.com"|"test@test.com"|"test@example.com"|"user@example.com"|"you@example.com"|"your.email@example.com"|*"@example.com"|*"@example.org"|*"@example.net")
    delivery_identity_bad=1
    ;;
  *@*.*)
    ;;
  *)
    delivery_identity_bad=1
    ;;
esac

delivery_inside="$(git rev-parse --is-inside-work-tree 2>/dev/null || true)"
delivery_bare="$(git rev-parse --is-bare-repository 2>/dev/null || true)"
delivery_core_bare="$(git config --get core.bare 2>/dev/null || true)"
delivery_topology_bad=0

if [ "$delivery_inside" != "true" ] || [ "$delivery_bare" != "false" ]; then
  delivery_topology_bad=1
fi

printf 'repository=%s\n' "$(pwd -P)"
printf 'git_dir=%s\n' "$(git rev-parse --git-dir 2>/dev/null || true)"
printf 'git_common_dir=%s\n' "$(git rev-parse --git-common-dir 2>/dev/null || true)"
printf 'is_inside_work_tree=%s\n' "$delivery_inside"
printf 'is_bare_repository=%s\n' "$delivery_bare"
printf 'core_bare=%s\n' "${delivery_core_bare:-<unset>}"
printf 'core_bare_source='
git config --show-origin --get core.bare 2>/dev/null || printf '<default>\n'

printf 'user_name_source='
git config --show-origin --get user.name 2>/dev/null || printf '<missing>\n'
printf 'user_email_source='
git config --show-origin --get user.email 2>/dev/null || printf '<missing>\n'
printf 'author_ident='
git var GIT_AUTHOR_IDENT 2>/dev/null || printf '<invalid>\n'
printf 'committer_ident='
git var GIT_COMMITTER_IDENT 2>/dev/null || printf '<invalid>\n'

printf 'head=%s\n' "$(git rev-parse --verify HEAD 2>/dev/null || printf '<unborn>')"
printf 'branch=%s\n' "$(git symbolic-ref --quiet --short HEAD 2>/dev/null || printf '<detached>')"

delivery_upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
if [ -n "$delivery_upstream" ]; then
  printf 'upstream=%s\n' "$delivery_upstream"
  printf 'divergence='
  git rev-list --left-right --count "HEAD...$delivery_upstream" 2>/dev/null || printf '<unavailable>\n'
else
  printf 'upstream=<none>\n'
  printf 'divergence=<unavailable>\n'
fi

printf '%s\n' 'status_begin'
git status --short --branch 2>/dev/null || printf '<status unavailable>\n'
printf '%s\n' 'status_end'

if [ "$delivery_identity_bad" -ne 0 ]; then
  printf 'ERROR Git identity is missing or looks like a placeholder.\n' >&2
  exit 2
fi

if [ "$delivery_topology_bad" -ne 0 ]; then
  printf 'ERROR repository topology is inconsistent with a normal worktree.\n' >&2
  exit 4
fi

printf 'preflight=ready\n'
