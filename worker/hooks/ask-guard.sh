#!/bin/bash
# PreToolUse guard for AskUserQuestion.
# Records the question in Ambrosio's queue and denies the call so the worker
# never blocks on a human. Fails closed: any internal error still denies.
set -uo pipefail

INPUT=$(cat)
HOME_DIR="${AMBROSIO_HOME:-$HOME/.ambrosio}"
QUEUE="$HOME_DIR/queue"
mkdir -p "$QUEUE" 2>/dev/null

deny() {
  # $1 = reason shown to the model
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' \
    "$(printf '%s' "$1" | jq -Rs .)"
  exit 0
}

SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // "unknown"' 2>/dev/null || echo unknown)

# Never trust AMBROSIO_TICKET on its own; see resolve-ticket.sh.
# shellcheck source=worker/hooks/resolve-ticket.sh
source "$(dirname "${BASH_SOURCE[0]}")/resolve-ticket.sh"
RESOLVED=$(resolve_ticket "$SESSION" "$CWD" "$HOME_DIR")
TICKET=$(printf '%s' "$RESOLVED" | sed -n 1p)
REPO=$(printf '%s' "$RESOLVED" | sed -n 2p)
QUESTIONS=$(printf '%s' "$INPUT" | jq -c '.tool_input.questions // []' 2>/dev/null || echo '[]')
FIRST=$(printf '%s' "$QUESTIONS" | jq -r '.[0].question // "(no question text)"' 2>/dev/null || echo "(no question text)")

# Stable id: same question from the same ticket reuses the same queue entry.
HASH=$(printf '%s|%s' "$TICKET" "$FIRST" | shasum -a 256 | cut -c1-10)
EXISTING=$(grep -ls "\"hash\": \"$HASH\"" "$QUEUE"/*.json 2>/dev/null | head -1)
if [ -n "$EXISTING" ]; then
  QID=$(jq -r '.qid' "$EXISTING" 2>/dev/null || echo "Q-$HASH")
  deny "Already recorded as $QID and waiting for Jaime. Do NOT ask again. Continue with any part of the task that does not depend on the answer; if nothing else can proceed, set the ticket to needs_input with 'bd -C \"$CWD\" update $TICKET --status needs_input' and end your turn."
fi

# Urgency: a small keyword floor, deliberately conservative.
URGENT=false
# Deliberately narrow: dangerous actions and real secrets, not any mention of
# "token" or "migration", which are ordinary words in ordinary questions.
if printf '%s' "$FIRST" | grep -qiE '\b(production|prod database|secret|credential|password|api key|payment|billing|charge the|irreversible|destructive|data loss)\b' \
   || printf '%s' "$FIRST" | grep -qiE '\b(delete|drop|wipe|truncate)\b.*\b(table|database|data|users|bucket|volume|branch)\b'; then
  URGENT=true
fi

QID="Q-$HASH"
FILE="$QUEUE/$QID.json"
jq -n \
  --arg qid "$QID" --arg kind question --arg ticket "$TICKET" --arg repo "$REPO" \
  --arg sessionId "$SESSION" --arg cwd "$CWD" --arg hash "$HASH" \
  --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson questions "$QUESTIONS" --argjson urgent "$URGENT" \
  '{qid:$qid, kind:$kind, ticket:$ticket, repo:$repo, sessionId:$sessionId, cwd:$cwd,
    questions:$questions, urgent:$urgent, status:"open", hash:$hash, createdAt:$createdAt}' \
  > "$FILE" 2>/dev/null

deny "Recorded as $QID for Jaime's next digest. Do NOT ask again and do NOT guess the answer. Continue with any part of the task that does not depend on it. If nothing else can proceed, write what you have to the work log, set the ticket to needs_input with 'bd -C \"$CWD\" update $TICKET --status needs_input', and end your turn."
