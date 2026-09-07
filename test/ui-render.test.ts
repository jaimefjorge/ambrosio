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
    localStorage: { store: {} as Record<string, string>, getItem(k: string) { return this.store[k] ?? null; }, setItem(k: string, v: string) { this.store[k] = v; } },
    CSS: { escape: (s: string) => s },
    fetch: (url: string, init: any) => {
      posted.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, answer: "because it is waiting on the gate" }) });
    },
    setInterval: () => 0,
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  };
  const api = new Function(...Object.keys(stubs),
    `${script}\nreturn { render, setMood: butler.setMoodFromBoard, openMenu, askAbout, closeMenu, sayToAmbrosio, showTab, renderTicket, openTicket };`)(...Object.values(stubs));
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

describe("a worker that says it is working but is not", () => {
  const worker = (silentFor: number | null) => renderPage({
    ...empty,
    workers: [{ id: "a1", name: "gmc-4or", state: "working", cwd: "/w", silentFor, ticketStatus: "in_progress", title: "e2e" }],
  }).workers;

  test("says how long it has been silent, next to the state that claims otherwise", () => {
    // The card read WORKING and "awaiting Verity Stop hook" for three and a half
    // hours after the worker had finished and gone quiet.
    expect(worker(219)).toContain("silent 3h39");
    expect(worker(219)).toContain("working");
  });

  test("a worker that is thinking is not accused", () => {
    expect(worker(4)).not.toContain("silent");
  });

  test("a session that has never spoken is not accused either", () => {
    expect(worker(null)).not.toContain("silent");
  });
});

// --- The morning must not open on a graveyard -------------------------------
// 2026-09-07, 16:11: nine cards, seven of them stopped or done. The view exists
// to catch a worker that failed silently, not to memorialise every session.

describe("parked and finished workers fold away", () => {
  const w = (o: any) => ({ id: o.name, cwd: "/w", ...o });

  test("only live, stuck, stale and failed workers sit in the main grid", () => {
    const out = renderPage({ ...empty, workers: [
      w({ name: "live", state: "working" }),
      w({ name: "stuck", state: "blocked" }),
      w({ name: "quiet", state: "stale" }),
      w({ name: "broke", state: "failed" }),
      w({ name: "parked", state: "stopped", ticketStatus: "deferred" }),
      w({ name: "finished", state: "done" }),
    ] }).workers;
    const grid = out.split("<details")[0];
    for (const n of ["live", "stuck", "quiet", "broke"]) expect(grid).toContain(n);
    for (const n of ["parked", "finished"]) expect(grid).not.toContain(n);
  });

  test("the folded section counts what it hides and can be opened", () => {
    const out = renderPage({ ...empty, workers: [
      w({ name: "parked", state: "stopped" }),
      w({ name: "finished", state: "done" }),
    ] }).workers;
    expect(out).toContain("<details");
    expect(out).toContain("2 parked or finished");
    expect(out).toContain("parked");
    expect(out).toContain("finished");
  });

  test("with nothing live and nothing folded, it still says so plainly", () => {
    expect(renderPage({ ...empty, workers: [] }).workers).toContain("No workers running.");
  });

  test("the header counts live workers, not every session ever", () => {
    const out = renderPage({ ...empty, workers: [
      w({ name: "a", state: "working" }), w({ name: "b", state: "stopped" }), w({ name: "c", state: "done" }),
    ] }).stats;
    expect(out).toContain("workers <b>1</b>");
    expect(out).toContain("parked <b>2</b>");
  });

  test("a paused fleet says so in the header", () => {
    const out = renderPage({ ...empty, paused: { since: "2026-09-07T15:58:00Z", reason: "taking stock" } }).stats;
    expect(out).toContain("PAUSED");
  });
});

// --- Talking to Ambrosio from the page ----------------------------------------

describe("the dialog", () => {
  const entry = (o: any) => ({ id: o.id ?? "e1", at: "2026-09-07T16:30:00Z", ...o });

  test("standing instructions are shown, each with a way to retire it", () => {
    const out = renderPage({ ...empty, instructions: [{ id: "i1", text: "gatemd first this week", at: "2026-09-07T16:00:00Z" }] }).standing;
    expect(out).toContain("gatemd first this week");
    expect(out).toContain('data-retire="i1"');
  });

  test("the thread shows both sides in order, and marks what Ambrosio actually did", () => {
    const out = renderPage({ ...empty, dialog: [
      entry({ id: "a", from: "jaime", text: "pause: taking stock", kind: "action" }),
      entry({ id: "b", from: "ambrosio", text: "Paused: taking stock.", kind: "action", ok: true, inReplyTo: "a" }),
      entry({ id: "c", from: "jaime", text: "why is gmc-4or stuck?", kind: "question" }),
      entry({ id: "d", from: "ambrosio", text: "It is waiting on the gate.", kind: "question", ok: true, inReplyTo: "c" }),
    ] }).thread;
    expect(out.indexOf("pause: taking stock")).toBeLessThan(out.indexOf("Paused: taking stock."));
    expect(out.indexOf("Paused: taking stock.")).toBeLessThan(out.indexOf("why is gmc-4or stuck?"));
    expect(out).toContain("did");
    expect(out).toContain("answered");
  });

  test("a reply that did not work is marked so", () => {
    const out = renderPage({ ...empty, dialog: [
      entry({ id: "a", from: "jaime", text: "gmc-9 defer", kind: "action" }),
      entry({ id: "b", from: "ambrosio", text: "That did not work: beads is locked", kind: "action", ok: false, inReplyTo: "a" }),
    ] }).thread;
    expect(out).toContain("could not");
  });

  test("sending posts to the dialog, not to ask", async () => {
    const m = mountFleet();
    await m.api.sayToAmbrosio("gatemd first this week");
    // The page also polls the board on load; only the dialog post matters here.
    const said = m.posted.filter((p) => p.body?.text !== undefined);
    expect(said.map((p) => p.url)).toEqual(["/api/dialog"]);
    expect(said[0].body).toEqual({ text: "gatemd first this week" });
    expect(m.posted.some((p) => p.url === "/api/ask")).toBe(false);
  });

  test("an empty thread invites the first message", () => {
    expect(renderPage({ ...empty }).thread).toContain("Tell Ambrosio");
  });
});


// --- The dialog lives in its own tab --------------------------------------------

describe("tabs", () => {
  test("the board is shown first and the dialog is hidden", () => {
    const m = mountFleet();
    m.api.render(empty);
    expect(m.nodes.board.hidden).toBe(false);
    expect(m.nodes.dialog.hidden).toBe(true);
  });

  test("switching to the dialog hides the board, and back again", () => {
    const m = mountFleet();
    m.api.showTab("dialog");
    expect(m.nodes.dialog.hidden).toBe(false);
    expect(m.nodes.board.hidden).toBe(true);
    m.api.showTab("board");
    expect(m.nodes.board.hidden).toBe(false);
  });

  test("an unknown tab falls back to the board rather than hiding everything", () => {
    const m = mountFleet();
    expect(m.api.showTab("nonsense")).toBe("board");
    expect(m.nodes.board.hidden).toBe(false);
  });

  test("the dialog tab wears a badge with how many instructions stand", () => {
    const m = mountFleet();
    m.api.render({ ...empty, instructions: [{ id: "a", text: "x", at: "" }, { id: "b", text: "y", at: "" }] });
    expect(m.nodes["tab-standing"].textContent).toBe("2");
    expect(m.nodes["tab-standing"].hidden).toBe(false);
    m.api.render(empty);
    expect(m.nodes["tab-standing"].hidden).toBe(true);
  });
});

describe("landable on the accept row", () => {
  const acc = (landable: any) => ({ ...empty, accept: [{ key: "A1", id: "gmc-axx", repo: "gatemd-core", title: "spinner tests", status: "in_review", landable }] });

  test("says landable, with the PR, when it is", () => {
    const out = renderPage(acc({ ok: true, pr: { number: 161, url: "https://github.com/x/y/pull/161" }, reasons: [] })).questions;
    expect(out).toContain("PR #161");
    expect(out).toContain("landable");
    expect(out).not.toContain("not landable");
  });

  test("names every reason when it is not, and the accept button says so", () => {
    const out = renderPage(acc({ ok: false, pr: { number: 161, url: "" }, reasons: ["unit pending", "open defects: gmc-sz7"] })).questions;
    expect(out).toContain("not landable: unit pending; open defects: gmc-sz7");
    expect(out).toContain("accept anyway");
  });

  test("without an assessment the row still renders", () => {
    expect(renderPage(acc(undefined)).questions).toContain("waiting for you to accept");
  });
});

describe("clicking finished work opens its context", () => {
  const detail = {
    ticket: { id: "gmc-axx", repo: "gatemd-core", title: "spinner tests", status: "in_review", priority: 3, description: "Tests fail under FORCE_COLOR.", acceptance: ["When FORCE_COLOR=0, tests pass", "When FORCE_COLOR=1, tests pass"] },
    externalRef: "https://linear.app/x/VRT-1",
    handover: "https://github.com/x/y/pull/161 · tests 19/19 · Verity: pending · reviewer: ACCEPT",
    comments: [],
    landable: { ok: false, pr: { number: 161, url: "https://github.com/x/y/pull/161" }, reasons: ["open defects: gmc-sz7"] },
    defects: [{ id: "gmc-sz7", title: "spinner nit", status: "open" }],
    plan: "# Plan\nstep 1",
    evidence: "## Evidence\nline 1\nline 2",
  };

  test("the drawer shows what was asked, each criterion, the hand-over, why it cannot land, what it filed, and the evidence", () => {
    const m = mountFleet();
    m.api.renderTicket(detail);
    const body = m.html("d-body");
    expect(m.html("d-name")).toContain("gmc-axx");
    expect(body).toContain("Tests fail under FORCE_COLOR.");
    expect(body).toContain("When FORCE_COLOR=0, tests pass");
    expect(body).toContain("When FORCE_COLOR=1, tests pass");
    expect(body).toContain("tests 19/19");
    expect(body).toContain("open defects: gmc-sz7");
    expect(body).toContain("spinner nit");
    expect(body).toContain("line 2");
    expect(body).toContain("VRT-1");
  });

  test("opening a ticket asks the ticket route, scoped by repo and id", async () => {
    const m = mountFleet();
    await m.api.openTicket("gatemd-core", "gmc-axx");
    expect(m.posted.some((p) => p.url === "/api/ticket/gatemd-core/gmc-axx")).toBe(true);
    expect(m.nodes.drawer.hidden).toBe(false);
  });

  test("the accept row is marked clickable and carries what to open", () => {
    const out = renderPage({ ...empty, accept: [{ key: "A1", id: "gmc-axx", repo: "gatemd-core", title: "spinner tests", status: "in_review" }] }).questions;
    expect(out).toContain('data-open="gmc-axx"');
    expect(out).toContain("details");
  });
});
