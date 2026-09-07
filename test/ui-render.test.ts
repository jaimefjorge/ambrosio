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
function mountFleet() {
  const html = readFileSync(join(rootDir(), "ui", "index.html"), "utf8");
  const butler = readFileSync(join(rootDir(), "ui", "butler.js"), "utf8");
  const script = butler + "\n" + /<script>([\s\S]*?)<\/script>/.exec(html)![1];

  const nodes: Record<string, any> = {};
  const posted: { url: string; body: any }[] = [];
  const node = (id: string) => (nodes[id] ??= {
    id, innerHTML: "", textContent: "", className: "", value: "", placeholder: "",
    disabled: false, hidden: false, dataset: {}, style: {},
    addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} },
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 216, height: 180 }),
    getContext: () => ({ fillRect() {}, clearRect() {}, fillStyle: "", imageSmoothingEnabled: true }),
  });

  const stubs = {
    document: {
      getElementById: node, addEventListener() {}, querySelector: () => null,
      querySelectorAll: () => [], documentElement: { dataset: {} }, body: {},
    },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }), innerWidth: 1400, innerHeight: 900 },
    CSS: { escape: (s: string) => s },
    fetch: (url: string, init: any) => {
      posted.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, answer: "because it is waiting on the gate" }) });
    },
    setInterval: () => 0,
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  };
  const api = new Function(...Object.keys(stubs),
    `${script}\nreturn { render, setMood: butler.setMoodFromBoard, openMenu, askAbout, closeMenu };`)(...Object.values(stubs));
  return { api, nodes, posted, html: (id: string) => `${nodes[id]?.innerHTML ?? ""}${nodes[id]?.textContent ?? ""}` };
}

/** Render a payload and return each node's text, for the panel assertions. */
function renderPage(payload: any): Record<string, string> {
  const m = mountFleet();
  m.api.render(payload);
  m.api.setMood(payload);
  return Object.fromEntries(Object.entries(m.nodes).map(([k, v]) => [k, `${v.innerHTML}${v.textContent}`]));
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

describe("where a worker stands in the cycle", () => {
  const withWorker = (ticketStatus: string) => renderPage({
    ...empty,
    workers: [{ id: "a1", name: "gmc-4or", state: "working", cwd: "/w", title: "Fresh-repo e2e", repo: "gatemd-core", ticketStatus }],
  }).workers;

  test("each worker gets a track drawn for its ticket's stage", () => {
    expect(withWorker("in_progress")).toContain('class="stage"');
    expect(withWorker("in_progress")).toContain('data-status="in_progress"');
  });

  test("the caption names the stage and its place in the cycle", () => {
    expect(withWorker("in_progress")).toContain("build");
    expect(withWorker("in_progress")).toContain("step 3 of 6");
    expect(withWorker("in_review")).toContain("your call");
    expect(withWorker("planning")).toContain("step 1 of 6");
  });

  test("a parked worker says it is waiting on Jaime, not that it is building", () => {
    const out = withWorker("needs_input");
    expect(out).toContain("parked");
    expect(out).toContain("waiting on you");
    expect(out).not.toContain("step 3 of 6");
  });

  test("a worker with no ticket gets no track rather than a wrong one", () => {
    const out = renderPage({ ...empty, workers: [{ id: "a1", name: "x", state: "done", cwd: "/w" }] }).workers;
    expect(out).not.toContain('class="stage"');
  });
});

describe("right-clicking a worker to ask about it", () => {
  test("the menu names the worker and offers the questions worth asking", () => {
    const m = mountFleet();
    m.api.openMenu(100, 100, "gmc-4or");

    const menu = m.nodes.menu.innerHTML;
    expect(m.nodes.menu.hidden).toBe(false);
    expect(menu).toContain("gmc-4or");
    expect(menu).toContain("Is it stuck?");
    expect(menu).toContain("What is left before this can be accepted?");
    expect(menu).toContain("Ask something else");
  });

  test("the question is scoped to the worker that was right-clicked", async () => {
    const m = mountFleet();
    await m.api.askAbout("Is it stuck?", "gmc-gfh");

    // The page also polls the board on load; only the ask matters here.
    const asks = m.posted.filter((p) => p.url === "/api/ask");
    expect(asks).toHaveLength(1);
    expect(asks[0].body).toMatchObject({ question: "Is it stuck?", ticket: "gmc-gfh" });
  });

  test("the answer says which worker it is about, so two answers cannot be confused", async () => {
    const m = mountFleet();
    await m.api.askAbout("Is it stuck?", "gmc-gfh");
    expect(m.nodes.answer.innerHTML).toContain("about gmc-gfh");
    expect(m.nodes.answer.innerHTML).toContain("waiting on the gate");
  });

  test("asking with no worker is about the fleet, not about nothing", async () => {
    const m = mountFleet();
    await m.api.askAbout("how is the day going?", undefined);
    expect(m.posted.filter((p) => p.url === "/api/ask")[0].body.ticket).toBeUndefined();
    expect(m.nodes.answer.innerHTML).toContain("about the fleet");
  });

  test("the menu stays on screen when the card is at the edge", () => {
    const m = mountFleet();
    m.api.openMenu(1390, 880, "gmc-4or");
    expect(parseInt(m.nodes.menu.style.left)).toBeLessThan(1390);
    expect(parseInt(m.nodes.menu.style.top)).toBeLessThan(880);
  });
});
