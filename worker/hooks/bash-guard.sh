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
# Merging is the final stage and it is Jaime's, not a worker's. This covers the
# PR route as well as the git one, because a green PR with known defects behind
# it is exactly what must not land on main by itself.
if printf '%s' "$CMD" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+merge\b'; then
  deny "Blocked: merging a PR is Jaime's call, and never happens while defects found in that work are still open. Hand over the draft PR instead."
fi
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+merge\b[^|;&]*\b(main|master|origin/(main|master))\b'; then
  deny "Blocked: merging into main is Jaime's call. Hand over your branch and let him decide."
fi
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+checkout[[:space:]]+(main|master)\b[^|;&]*&&[^|;&]*git[[:space:]]+merge'; then
  deny "Blocked: merging into main is Jaime's call. Hand over your branch and let him decide."
fi

# Nothing a worker runs may reach production. This is a floor, not a judgement
# call: releasing, publishing and deploying are Jaime's, always, and a worker
# that thinks it has a good reason is exactly the case this exists for.
if printf '%s' "$CMD" | grep -qE '\b(vercel|netlify|fly|flyctl|railway|heroku)[[:space:]]+(deploy|launch|release)\b'; then
  deny "Blocked: deploying is Jaime's call and never a worker's. Hand over the branch."
fi
if printf '%s' "$CMD" | grep -qE '\bnpm[[:space:]]+publish\b|\byarn[[:space:]]+publish\b|\bpnpm[[:space:]]+publish\b|\bcargo[[:space:]]+publish\b|\btwine[[:space:]]+upload\b'; then
  deny "Blocked: publishing a package is a release. That is Jaime's call."
fi
if printf '%s' "$CMD" | grep -qE '\bgh[[:space:]]+release[[:space:]]+(create|edit|upload|delete)\b'; then
  deny "Blocked: cutting a release is Jaime's call."
fi
if printf '%s' "$CMD" | grep -qE '\bkubectl[[:space:]]+(apply|delete|rollout|scale)\b|\bhelm[[:space:]]+(install|upgrade|uninstall)\b'; then
  deny "Blocked: changing a cluster is Jaime's call."
fi
if printf '%s' "$CMD" | grep -qE '\bterraform[[:space:]]+(apply|destroy)\b|\bpulumi[[:space:]]+up\b'; then
  deny "Blocked: applying infrastructure changes is Jaime's call."
fi
if printf '%s' "$CMD" | grep -qE '\bsupabase[[:space:]]+db[[:space:]]+(push|reset)\b|\bprisma[[:space:]]+migrate[[:space:]]+deploy\b|\bdrizzle-kit[[:space:]]+push\b'; then
  deny "Blocked: running a migration against a real database is Jaime's call."
fi
if printf '%s' "$CMD" | grep -qE '\bdocker[[:space:]]+push\b'; then
  deny "Blocked: pushing an image is a release step. That is Jaime's call."
fi
if printf '%s' "$CMD" | grep -qE '\bgit[[:space:]]+tag\b[^|;&]*-[^|;&]*&&[^|;&]*push|\bgit[[:space:]]+push[^|;&]*--tags\b'; then
  deny "Blocked: pushing tags is how a release starts. That is Jaime's call."
fi

# The machine's own global npm packages are not a worker's to remove.
#
# gmc-szb, 2026-09-07: a harness took the global `verity` off Jaime's machine
# and left the package installed, so `npm install -g` would have no-opped on
# version rather than relinked. The mechanism there turned out to be a `mv` with
# a symlink-blind restore rather than an uninstall — but the incident showed the
# class has no floor at all, and Jaime's call was to put one here.
#
# `--prefix` is the exception, and it is the whole point: a harness that installs
# into a prefix it created under $TMPDIR must be able to tear that down. What it
# may not do is remove from whatever prefix the machine happens to have. The
# second clause closes the obvious way back in — pointing `--prefix` at the
# machine's own prefix is the machine-wide form wearing a flag.
if printf '%s' "$CMD" | grep -qE '\b(npm|pnpm|bun)[[:space:]]+([^|;&]*[[:space:]])?(rm|r|un|uninstall|unlink|remove)\b[^|;&]*(-g|--global)\b' \
  || printf '%s' "$CMD" | grep -qE '\b(npm|pnpm|bun)[[:space:]]+([^|;&]*[[:space:]])?(-g|--global)[[:space:]]+[^|;&]*\b(rm|r|un|uninstall|unlink|remove)\b' \
  || printf '%s' "$CMD" | grep -qE '\byarn[[:space:]]+global[[:space:]]+remove\b'; then
  if ! printf '%s' "$CMD" | grep -qE '\-\-prefix([=[:space:]])' \
    || printf '%s' "$CMD" | grep -qE '\-\-prefix[=[:space:]][^|;&]*npm[[:space:]]+(prefix|root|bin)[[:space:]]+(-g|--global)'; then
    deny "Blocked: removing a global npm package would reach outside this ticket and take a tool off Jaime's machine. Scope it to a prefix your run owns (npm rm -g --prefix \"\$WORK/npm-global\" <pkg>), and never to the machine's own prefix. If you are only writing this string into a file, use the Write tool — the guard reads the command, not your intent."
  fi
fi

exit 0
