import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, ConfigError, hhmm, withinHours, repoByName } from "../src/config.ts";

function writeConfig(extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "amb-cfg-"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  const file = join(dir, "c.json");
  writeFileSync(file, JSON.stringify({ repos: [{ name: "r", path: repo, prefix: "r" }], ...extra }));
  return { dir, file, repo };
}

test("loads config and applies defaults", () => {
  const { file, repo } = writeConfig();
  const cfg = loadConfig(file);
  expect(cfg.repos[0].path).toBe(repo);
  expect(cfg.wipLimit).toBe(3);
  expect(cfg.hours.wrapUp).toBe("15:00");
});

test("AMBROSIO_HOME overrides the home directory", () => {
  const { file } = writeConfig();
  process.env.AMBROSIO_HOME = "/tmp/amb-test-home";
  expect(loadConfig(file).homeDir).toBe("/tmp/amb-test-home");
  delete process.env.AMBROSIO_HOME;
});

test("throws a ConfigError when a repo path is missing", () => {
  const { dir } = writeConfig();
  const file = join(dir, "bad.json");
  writeFileSync(file, JSON.stringify({ repos: [{ name: "x", path: "/nope/nope", prefix: "x" }] }));
  expect(() => loadConfig(file)).toThrow(ConfigError);
});

test("throws when repos is empty", () => {
  const { dir } = writeConfig();
  const file = join(dir, "empty.json");
  writeFileSync(file, JSON.stringify({ repos: [] }));
  expect(() => loadConfig(file)).toThrow(ConfigError);
});

test("repoByName resolves by name or prefix and reports unknown", () => {
  const { file } = writeConfig();
  const cfg = loadConfig(file);
  expect(repoByName(cfg, "r").name).toBe("r");
  expect(() => repoByName(cfg, "zzz")).toThrow(/unknown repo/);
});

test("hhmm and withinHours", () => {
  const { file } = writeConfig();
  const cfg = loadConfig(file);
  expect(hhmm("09:30")).toBe(570);
  expect(withinHours(cfg, new Date(2026, 8, 7, 11, 0))).toBe(true);
  expect(withinHours(cfg, new Date(2026, 8, 7, 22, 0))).toBe(false);
  expect(withinHours(cfg, new Date(2026, 8, 7, 6, 0))).toBe(false);
});
