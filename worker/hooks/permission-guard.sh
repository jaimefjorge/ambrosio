#!/bin/bash
# PermissionRequest guard. An unattended worker cannot answer a permission
# prompt, so record it as urgent and deny rather than let the session hang.
set -uo pipefail

INPUT=$(cat)
HOME_DIR="${AMBROSIO_HOME:-$HOME/.ambrosio}"
QUEUE="$HOME_DIR/queue"
mkdir -p "$QUEUE" 2>/dev/null

TICKET="${AMBROSIO_TICKET:-unknown}"
REPO="${AMBROSIO_REPO:-unknown}"
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // "unknown"' 2>/dev/null || echo unknown)
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // "unknown"' 2>/dev/null || echo unknown)
SUMMARY=$(printf '%s' "$INPUT" | jq -c '.tool_input // {}' 2>/dev/null | cut -c1-500)

HASH=$(printf '%s|%s|%s' "$TICKET" "$TOOL" "$SUMMARY" | shasum -a 256 | cut -c1-10)
QID="Q-$HASH"
if [ ! -f "$QUEUE/$QID.json" ]; then
  jq -n --arg qid "$QID" --arg kind permission --arg ticket "$TICKET" --arg repo "$REPO" \
    --arg sessionId "$SESSION" --arg cwd "$CWD" --arg tool "$TOOL" --arg summary "$SUMMARY" \
    --arg hash "$HASH" --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{qid:$qid, kind:$kind, ticket:$ticket, repo:$repo, sessionId:$sessionId, cwd:$cwd,
      tool:$tool, summary:$summary, urgent:true, status:"open", hash:$hash, createdAt:$createdAt}' \
    > "$QUEUE/$QID.json" 2>/dev/null
fi

printf '{"decision":{"behavior":"deny","message":%s}}\n' \
  "$(printf 'Needs Jaime: recorded as %s. Do not retry this tool. Continue with work that does not need it, or set the ticket to needs_input and end your turn.' "$QID" | jq -Rs .)"
exit 0
