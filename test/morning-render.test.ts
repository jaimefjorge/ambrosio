import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rootDir } from "../src/config.ts";

/**
 * Mounts the morning page's own script against a stub DOM.
 *
 * The page is not otherwise executed by anything, and this project has already
 * shipped rendering faults that read fine in review.
 */
function mount() {
  const html = readFileSync(join(rootDir(), "ui", "morning.html"), "utf8");
  const butler = readFileSync(join(rootDir(), "ui", "butler.js"), "utf8");
  const script = butler + "\n" + [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()![1];

  const nodes: Record<string, any> = {};
  const node = (id: string) => (nodes[id] ??= {
    id, innerHTML: "", textContent: "", className: "", value: "", disabled: false, hidden: false, dataset: {},
    addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} },
    querySelector: () => null, querySelectorAll: () => [],
    getContext: () => ({ fillRect() {}, clearRect() {}, fillStyle: "", imageSmoothingEnabled: true }),
  });
  const stubs = {
    document: { getElementById: node, addEventListener() {}, querySelector: () => null, documentElement: { dataset: {} }, body: {} },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
    CSS: { escape: (s: string) => s },
    fetch: () => new Promise(() => {}),          // start() stays pending; tests drive directly
    setInterval: () => 0,
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  };
  const api = new Function(...Object.keys(stubs), `${script}\nreturn { render, renderProjects, showFocus, picked, updateBar };`)(
    ...Object.values(stubs),
  );
  return { api, nodes, html: (id: string) => `${nodes[id]?.innerHTML ?? ""}|${nodes[id]?.textContent ?? ""}` };
}

const base = {
  date: "2026-09-08T08:00:00.000Z", greeting: "Good morning, sir.", mission: "", repos: [],
  capacity: { used: 0, limit: 3, free: 3 },
  carryover: [], waiting: [], ready: [], inFlight: [], prs: [], linear: [],
  recap: { accepted: [], dispatched: [], night: [] }, lessons: [], yesterdayReview: null,
  verity: [], sources: [{ name: "Board", ok: true, detail: "read" }],
};

describe("choosing the day first", () => {
  test("offers each project with enough on it to choose well", () => {
    const m = mount();
    m.api.renderProjects([{ name: "gatemd-core", open: 7, running: 1, waiting: 2 }]);

    expect(m.html("projects")).toContain("gatemd-core");
    expect(m.html("projects")).toContain("2 waiting on you");
    expect(m.html("projects")).toContain("7 open");
  });

  test("the focus step hides the brief until the day is set", () => {
    const m = mount();
    m.api.showFocus();
    expect(m.nodes.focus.hidden).toBe(false);
    expect(m.nodes.set.hidden).toBe(false);
    expect(m.nodes.begin.hidden).toBe(true);
  });
});

describe("the brief, once the day is set", () => {
  test("states the mission and the projects it is scoped to", () => {
    const m = mount();
    m.api.render({ ...base, mission: "ship the release gate", repos: ["gatemd-core"] });

    expect(m.html("brief")).toContain("ship the release gate");
    expect(m.html("brief")).toContain("gatemd-core");
    expect(m.html("brief")).toContain("change");     // back to the focus step
  });

  test("greets by the hour and says how much capacity the day has", () => {
    const m = mount();
    m.api.render(base);
    expect(m.html("greeting")).toContain("Good morning");
    expect(m.html("slots")).toContain("Nothing running yet");
  });

  test("shows what is waiting, what carried over, the PRs and what is ready", () => {
    const m = mount();
    m.api.render({
      ...base,
      waiting: [{ key: "A1", kind: "accept", id: "gmc-4or", repo: "gatemd-core", title: "Fresh-repo e2e" }],
      carryover: [{ at: "11:11", kind: "OPEN ACTION", text: "chase the Verity verdict" }],
      prs: [{ repo: "gatemd-core", number: 9, title: "Opengrep ruleset", url: "u", isDraft: false, checks: "failing", updatedAt: "", flag: "checks failing", rank: 0 }],
      ready: [{ id: "gmc-szb", repo: "gatemd-core", title: "verity bin symlink removed", status: "open", priority: 1 }],
    });
    const out = m.html("brief");
    expect(out).toContain("A1");
    expect(out).toContain("chase the Verity verdict");
    expect(out).toContain("checks failing");
    expect(out).toContain('data-id="gmc-szb"');
  });

  test("a source that could not be read says so, instead of an empty panel", () => {
    const m = mount();
    m.api.render({ ...base, sources: [...base.sources, { name: "Linear", ok: false, detail: "no api key — add linear.apiKey" }] });
    expect(m.html("brief")).toContain("no api key");
  });

  test("a genuinely empty morning is a pleasant one, not a broken one", () => {
    const m = mount();
    m.api.render(base);
    expect(m.html("brief")).toContain("Enjoy the quiet");
  });

  test("a full fleet is stated plainly rather than offering slots that do not exist", () => {
    const m = mount();
    m.api.render({ ...base, capacity: { used: 3, limit: 3, free: 0 } });
    expect(m.html("slots")).toContain("All 3 slots are busy");
  });
});

describe("starting the day by knowing yesterday", () => {
  const withRecap = (extra: any) => {
    const m = mount();
    m.api.render({ ...base, ...extra });
    return m.html("brief");
  };

  test("shows what was accepted and what the night shift did", () => {
    const out = withRecap({
      recap: { accepted: ["gmc-gfh (PR 156)"], dispatched: [], night: ["started gmc-szb (symlink)"] },
    });
    expect(out).toContain("Since yesterday");
    expect(out).toContain("gmc-gfh (PR 156)");
    expect(out).toContain("after hours");
    expect(out).toContain("started gmc-szb");
  });

  test("plays back what Jaime said at the end of yesterday", () => {
    const out = withRecap({ yesterdayReview: { wentWell: "two landed clean", doBetter: "ask about branches" } });
    expect(out).toContain("Yesterday you said");
    expect(out).toContain("two landed clean");
    expect(out).toContain("ask about branches");
  });

  test("standing lessons say they reach every worker, so they are not just a note", () => {
    const out = withRecap({ lessons: [{ date: "2026-09-07", lesson: "smaller tickets" }] });
    expect(out).toContain("smaller tickets");
    expect(out).toContain("every worker is told this");
  });

  test("a first-ever morning has no recap section rather than an empty one", () => {
    expect(withRecap({})).not.toContain("Since yesterday");
  });
});
