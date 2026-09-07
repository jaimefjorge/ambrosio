#!/bin/bash
# PreToolUse guard for Bash. Blocks the handful of commands a worker must
# never run unattended. Everything else passes through untouched.
set -uo pipefail

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' \
    "$(printf '%s' "$1" | jq -Rs .)"
  exit 0
}

# Push to a protected branch, in either argument order.
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+push([[:space:]]+[^|;&]*)?[[:space:]]+(origin[[:space:]]+)?(main|master)\b'; then
  deny "Blocked: pushing to main/master is Jaime's call. Push your ticket branch and open a draft PR instead."
fi
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+push[^|;&]*(--force|-f\b|--delete)'; then
  deny "Blocked: force pushes and remote branch deletes are never allowed for workers."
fi
if printf '%s' "$CMD" | grep -qE '(--no-verify|-n[[:space:]]*$)' && printf '%s' "$CMD" | grep -qE 'git[[:space:]]+(commit|push)'; then
  deny "Blocked: --no-verify skips the quality gate. Fix what the hook reports instead."
fi
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard[[:space:]]+(origin/)?(main|master)\b'; then
  deny "Blocked: hard reset onto a shared branch destroys work. Rebase or ask via a question instead."
fi
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+(merge|rebase)[^|;&]*--(no-ff|onto)?[^|;&]*\bmain\b.*&&.*push'; then
  deny "Blocked: merging into main is Jaime's call."
fi

exit 0
