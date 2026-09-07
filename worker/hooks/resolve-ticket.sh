#!/bin/bash
# Work out which ticket a hook invocation belongs to.
#
# AMBROSIO_TICKET is set per dispatch, but a background session can inherit the
# supervisor's environment from an *earlier* spawn, so it happily names the
# wrong ticket. That is not cosmetic: the ticket picks which worker gets Jaime's
# answer, and it feeds the dedupe hash, so a stale value can hand a decision to
# the wrong worker or collapse two workers' questions into one entry.
#
# session_id and cwd come from the hook payload and describe the session that is
# actually running, so they are preferred. Prints two lines: ticket, then repo.
resolve_ticket() {
  local session="$1" cwd="$2" home="$3"
  local f ticket repo base

  # 1. The session id recorded at dispatch time is definitive.
  if [ -n "$session" ] && [ "$session" != "unknown" ]; then
    for f in "$home"/work/*/*/sessions.json; do
      [ -e "$f" ] || continue
      if jq -e --arg s "$session" 'any(.[]?; .sessionId == $s or .id == $s)' "$f" >/dev/null 2>&1; then
        ticket=$(basename "$(dirname "$f")")
        repo=$(basename "$(dirname "$(dirname "$f")")")
        printf '%s\n%s\n' "$ticket" "$repo"
        return 0
      fi
    done
  fi

  # 2. A worker edits in .claude/worktrees/<ticket>-<slug>, so match the leaf
  #    against the tickets Ambrosio knows it has dispatched.
  if [ -n "$cwd" ] && [ "$cwd" != "unknown" ]; then
    base=$(basename "$cwd")
    for f in "$home"/work/*/*; do
      [ -d "$f" ] || continue
      ticket=$(basename "$f")
      case "$base" in
        "$ticket" | "$ticket"-*)
          repo=$(basename "$(dirname "$f")")
          printf '%s\n%s\n' "$ticket" "$repo"
          return 0
          ;;
      esac
    done
  fi

  # 3. Nothing better to go on.
  printf '%s\n%s\n' "${AMBROSIO_TICKET:-unknown}" "${AMBROSIO_REPO:-unknown}"
}
