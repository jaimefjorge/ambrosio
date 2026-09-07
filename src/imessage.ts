import { spawnSync } from "node:child_process";
import type { AmbrosioConfig } from "./config.ts";

export class IMessageError extends Error {}

function escapeForAppleScript(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Send via Messages.app. The channel plugin handles inbound; this is the
 * outbound path used by the CLI and by scripts that are not the tick session.
 */
export function send(cfg: AmbrosioConfig, text: string, handle?: string): void {
  const to = handle ?? cfg.imessage.handle;
  if (!to) {
    throw new IMessageError(
      "No iMessage handle configured. Set imessage.handle in ambrosio.config.json to the phone number or Apple ID you text yourself with.",
    );
  }
  const script = `
tell application "Messages"
  set svc to 1st account whose service type = iMessage
  set buddy to participant "${escapeForAppleScript(to)}" of svc
  send "${escapeForAppleScript(text)}" to buddy
end tell`;
  const r = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) {
    throw new IMessageError(
      `osascript failed: ${(r.stderr ?? "").trim().split("\n")[0]}. If this is the first send, macOS asks permission to control Messages — accept it.`,
    );
  }
}

export function sendAll(cfg: AmbrosioConfig, chunks: string[], handle?: string): void {
  for (const c of chunks) send(cfg, c, handle);
}
