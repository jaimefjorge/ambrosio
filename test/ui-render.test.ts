import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rootDir } from "../src/config.ts";

/**
 * Runs the fleet view's own script against a stub DOM and calls render().
 *
 * The page is the one part of Ambrosio that no other test executes, and it has
 * already shipped two faults that read fine in review: a panel keyed on
 * `questions.length` that hid plans and finished work, and a payload field the
 * markup never used. Rendering it here catches that class of thing.
 */
function renderPage(payload: any): Record<string, string> {
  const html = readFileSync(join(rootDir(), "ui", "index.html"), "utf8");
  const butler = readFileSync(join(rootDir(), "ui", "butler.js"), "utf8");
  const script = butler + "\n" + /<script>([\s\S]*?)<\/script>/.exec(html)![1];

  const nodes: Record<string, any> = {};
  const node = (id: string) => (nodes[id] ??= {
    id, innerHTML: "", textContent: "", className: "", hidden: false, dataset: {},
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    getContext: () => ({ fillRect() {}, clearRect() {}, fillStyle: "", imageSmoothingEnabled: true }),
  });

  const document = {
    getElementById: node,
    addEventListener() {},
    querySelector: () => null,
    documentElement: { dataset: {} },
    body: {},
  };
  const window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
  const stubs = {
    document, window,
    CSS: { escape: (s: string) => s },
    fetch: async () => ({ ok: true, json: async () => ({ error: "stubbed" }) }),
    setInterval: () => 0,
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  };

  const fn = new Function(
    ...Object.keys(stubs),
    `${script}\nreturn { render, setMood: butler.setMoodFromBoard };`,
  );
  const api = fn(...Object.values(stubs));
  api.render(payload);
  api.setMood(payload);
  return Object.fromEntries(Object.entries(nodes).map(([k, v]) => [k, `${v.innerHTML}${v.textContent}`]));
}

const empty = { now: "", wip: { used: 0, limit: 3 }, workers: [], questions: [], plans: [], accept: [], tickets: [], anomalies: [] };

describe("the fleet view's NEEDS YOU panel", () => {
  test("shows finished work waiting to be accepted, with no questions at all", () => {
    // Exactly the state Jaime hit: two tickets in review, zero parked questions.
    const out = renderPage({
      ...empty,
      accept: [
        { key: "A1", id: "gmc-gfh", repo: "gatemd-core", title: "npm-to-plugin migration", status: "in_review" },
        { key: "A2", id: "gmc-4or", repo: "gatemd-core", title: "Fresh-repo e2e", status: "in_review" },
      ],
    });

    expect(out.questions).not.toContain("Nothing waiting on you");
    expect(out.questions).toContain("A1");
    expect(out.questions).toContain("gmc-gfh");
    expect(out.questions).toContain("accept");
  });

  test("shows a plan waiting for review", () => {
    const out = renderPage({
      ...empty,
      plans: [{ key: "P1", id: "gmc-abc", repo: "gatemd-core", title: "Plan the migration", status: "plan_review" }],
    });
    expect(out.questions).toContain("P1");
    expect(out.questions).toContain("approve");
  });

  test("still shows parked questions", () => {
    const out = renderPage({
      ...empty,
      questions: [{ key: "Q1", qid: "q-1", ticket: "T-1", repo: "r", urgent: false, summary: "Which budget?", options: ["a", "b"] }],
    });
    expect(out.questions).toContain("Q1");
    expect(out.questions).toContain("Which budget?");
  });

  test("says nothing is waiting only when nothing is", () => {
    expect(renderPage(empty).questions).toContain("Nothing waiting on you");
  });

  test("the butler counts all three kinds, so he is not idle while work waits", () => {
    const out = renderPage({ ...empty, accept: [{ key: "A1", id: "t", repo: "r", title: "x", status: "in_review" }] });
    expect(out.bubble).toContain("waiting on you");
  });
});

test("the page and the server agree on the API version", () => {
  // The page hardcodes the version the code on disk expects; the server reports
  // the one compiled into the running process, and a mismatch is how a stale
  // server is caught. That only works if these two are bumped together — they
  // were not, and the fleet view told Jaime to restart a server that was fine.
  const server = /UI_VERSION = "(\d+)"/.exec(readFileSync(join(rootDir(), "src", "ui.ts"), "utf8"))![1];
  const page = /UI_VERSION = "(\d+)"/.exec(readFileSync(join(rootDir(), "ui", "index.html"), "utf8"))![1];
  expect(page).toBe(server);
});
