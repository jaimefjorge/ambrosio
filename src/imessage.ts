import { spawnSync } from "node:child_process";
import type { AmbrosioConfig } from "./config.ts";
import { recordSent } from "./inbox.ts";

export class IMessageError extends Error {}

function escapeForAppleScript(text: string): string {
  // AppleScript string literals cannot span lines, so a raw newline in a digest
  // is a syntax error. \n and \r are the escapes AppleScript itself understands.
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

/**
 * Messages on macOS 26 refuses `participant "…" of <account reference>` with
 * -10003 "Access not allowed", even with Automation permission granted. Going
 * through `service id` and asking for a `buddy` is the form that still works.
 */
export function buildSendScript(handle: string, text: string): string {
  return `tell application "Messages"
set svcId to id of 1st account whose service type = iMessage
send "${escapeForAppleScript(text)}" to buddy "${escapeForAppleScript(handle)}" of service id svcId
end tell`;
}

/**
 * Send via Messages.app.
 *
 * Every send is recorded before it goes out: it lands in the same self-chat as
 * Jaime's own messages and is indistinguishable from them in the database, so
 * `inbox.readInbound` needs to know what was ours.
 */
export function send(cfg: AmbrosioConfig, text: string, handle?: string): void {
  const to = handle ?? cfg.imessage.handle;
  if (!to) {
    throw new IMessageError(
      "No iMessage handle configured. Set imessage.handle in ambrosio.config.json to the phone number or Apple ID you text yourself with.",
    );
  }
  recordSent(cfg.homeDir, text);
  const r = spawnSync("osascript", ["-e", buildSendScript(to, text)], { encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) {
    throw new IMessageError(
      `osascript failed: ${(r.stderr ?? "").trim().split("\n")[0]}. If this is the first send, macOS asks permission to control Messages — accept it.`,
    );
  }
}

export function sendAll(cfg: AmbrosioConfig, chunks: string[], handle?: string): void {
  for (const c of chunks) send(cfg, c, handle);
}
