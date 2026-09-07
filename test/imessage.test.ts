import { describe, expect, test } from "bun:test";
import { buildSendScript, send, IMessageError } from "../src/imessage.ts";
import type { AmbrosioConfig } from "../src/config.ts";

describe("buildSendScript", () => {
  test("addresses the buddy through `service id`, not through an account reference", () => {
    // Messages on macOS 26 refuses `participant "…" of <account ref>` with
    // -10003 Access not allowed. `buddy "…" of service id <id>` works.
    const script = buildSendScript("+351900000000", "hello");
    expect(script).toContain("id of 1st account whose service type = iMessage");
    expect(script).toContain('buddy "+351900000000" of service id svcId');
    expect(script).not.toContain("of svc\n");
  });

  test("escapes quotes and backslashes in the handle and the text", () => {
    const script = buildSendScript('a"b', 'say "hi" \\ bye');
    expect(script).toContain('buddy "a\\"b"');
    expect(script).toContain('send "say \\"hi\\" \\\\ bye"');
  });

  test("keeps a multi-line digest on one AppleScript line", () => {
    const script = buildSendScript("+1", "line one\nline two");
    expect(script).toContain('"line one\\nline two"');
    expect(script.split("\n").length).toBe(4);
  });
});

describe("send", () => {
  test("refuses to send when no handle is configured", () => {
    const cfg = { imessage: { handle: "" } } as AmbrosioConfig;
    expect(() => send(cfg, "hi")).toThrow(IMessageError);
  });
});
