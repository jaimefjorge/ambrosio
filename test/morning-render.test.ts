import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rootDir } from "../src/config.ts";

/** Runs the morning page's own script against a stub DOM and calls render(). */
function renderMorning(brief: any): Record<string, string> {
  const html = readFileSync(join(rootDir(), "ui", "morning.html"), "utf8");
  const butler = readFileSync(join(rootDir(), "ui", "butler.js"), "utf8");
  const script = butler + "\n" + [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()![1];

  const nodes: Record<string, any> = {};
  const node = (id: string) => (nodes[id] ??= {
    id, innerHTML: "", textContent: "", className: "", disabled: false, dataset: {},
    addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} },
    querySelector: () => null, querySelectorAll: () => [],
    getContext: () => ({ fillRect() {}, clearRect() {}, fillStyle: "", imageSmoothingEnabled: true }),
  });
  const stubs = {
    document: { getElementById: node, addEventListener() {}, querySelector: () => null, documentElement: { dataset: {} }, body: {} },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
    CSS: { escape: (s: string) => s },
    fetch: () => new Promise(() => {}),      // load() stays pending; render() is called directly
    setInterval: () => 0,
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  };
  const fn = new Function(...Object.keys(stubs), `${script}\nreturn { render };`);
  fn(...Object.values(stubs)).render(brief);
  return Object.fromEntries(Object.entries(nodes).map(([k, v]) => [k, `${v.innerHTML}|${v.textContent}`]));
}

const base = {
  date: "2026-09-08T08:00:00.000Z", greeting: "Good morning, sir.",
  capacity: { used: 0, limit: 3, free: 3 },
  carryover: [], waiting: [], ready: [], inFlight: [], prs: [], linear: [],
  verity: [], sources: [{ name: "Board", ok: true, detail: "read" }],
};

describe("the morning brief page", () => {
  test("greets by the hour and says how much capacity the day has", () => {
    const out = renderMorning(base);
    expect(out.greeting).toContain("Good morning");
    expect(out.slots).toContain("3");
    expect(out.slots).toContain("Nothing running yet");
  });

  test("shows what is waiting, what carried over, the PRs and what is ready", () => {
    const out = renderMorning({
      ...base,
      waiting: [{ key: "A1", kind: "accept", id: "gmc-4or", repo: "gatemd-core", title: "Fresh-repo e2e" }],
      carryover: [{ at: "11:11", kind: "OPEN ACTION", text: "chase the Verity verdict" }],
      prs: [{ repo: "gatemd-core", number: 9, title: "Opengrep ruleset", url: "u", isDraft: false, checks: "failing", updatedAt: "", flag: "checks failing", rank: 0 }],
      ready: [{ id: "gmc-szb", repo: "gatemd-core", title: "verity bin symlink removed", status: "open", priority: 1 }],
    });
    expect(out.brief).toContain("A1");
    expect(out.brief).toContain("chase the Verity verdict");
    expect(out.brief).toContain("checks failing");
    expect(out.brief).toContain("gmc-szb");
    expect(out.brief).toContain("data-id=\"gmc-szb\"");   // pickable
  });

  test("a source that could not be read says so, instead of an empty panel", () => {
    const out = renderMorning({
      ...base,
      sources: [...base.sources, { name: "Linear", ok: false, detail: "no api key — add linear.apiKey" }],
    });
    expect(out.brief).toContain("no api key");
  });

  test("a genuinely empty morning is a pleasant one, not a broken one", () => {
    expect(renderMorning(base).brief).toContain("Enjoy the quiet");
  });

  test("a full fleet is stated plainly rather than offering slots that do not exist", () => {
    const out = renderMorning({ ...base, capacity: { used: 3, limit: 3, free: 0 } });
    expect(out.slots).toContain("All 3 slots are busy");
  });
});
