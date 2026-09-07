// Ambrosio, the butler. A 24x24 sprite drawn a pixel at a time, shared by the
// fleet view, the morning brief, and each worker's place in the cycle.

// Ambrosio, the butler. A 24x24 sprite drawn a pixel at a time, shared by the
// fleet view and the morning brief.
// --- Ambrosio ---------------------------------------------------------------
// A 24x24 butler who wanders the corner like a Tamagotchi and reacts to the
// fleet. Drawn a pixel at a time onto a 48x30 canvas, scaled up by CSS with
// nearest-neighbour, so it stays properly pixelated at any zoom.

const SPRITES = {
  stand: ["........................", "........oooooooo........", "......oohhhhhhhhoo......", ".....ohhhhhhhhhhhho.....", "....ohhhhhHHHHhhhhho....", ".....ohhsssssssshho.....", ".....ohsseesseessho.....", ".....ohssssssssssho.....", ".....osssmmmmmmssso.....", ".....ossssddddsssso.....", "......oddddddddddo......", ".......owwwwwwwwo.......", "....occcccwoowccccco....", "...occccccCwwCcccccco...", "...occcccccwwccccccco...", "...occcccccccccccccco...", "...occcccccccccccccco...", "....occcccccccccccco....", ".....occcc....cccco.....", ".....occcc....cccco.....", "....oooooo....oooooo....", "........................", "........................", "........................"],
  blink: ["........................", "........oooooooo........", "......oohhhhhhhhoo......", ".....ohhhhhhhhhhhho.....", "....ohhhhhHHHHhhhhho....", ".....ohhsssssssshho.....", ".....ohssddssddssho.....", ".....ohssssssssssho.....", ".....osssmmmmmmssso.....", ".....ossssddddsssso.....", "......oddddddddddo......", ".......owwwwwwwwo.......", "....occcccwoowccccco....", "...occccccCwwCcccccco...", "...occcccccwwccccccco...", "...occcccccccccccccco...", "...occcccccccccccccco...", "....occcccccccccccco....", ".....occcc....cccco.....", ".....occcc....cccco.....", "....oooooo....oooooo....", "........................", "........................", "........................"],
  walk: ["........................", "........oooooooo........", "......oohhhhhhhhoo......", ".....ohhhhhhhhhhhho.....", "....ohhhhhHHHHhhhhho....", ".....ohhsssssssshho.....", ".....ohsseesseessho.....", ".....ohssssssssssho.....", ".....osssmmmmmmssso.....", ".....ossssddddsssso.....", "......oddddddddddo......", ".......owwwwwwwwo.......", "....occcccwoowccccco....", "...occccccCwwCcccccco...", "...occcccccwwccccccco...", "...occcccccccccccccco...", "...occcccccccccccccco...", "....occcccccccccccco....", "....occcc......cccco....", ".....occcc....cccco.....", "...oooooo......oooooo...", "........................", "........................", "........................"],
  bow: ["........................", "........................", "........................", "........oooooooo........", "......oohhhhhhhhoo......", ".....ohhhhhhhhhhhho.....", "....ohhhhhHHHHhhhhho....", ".....ohhsssssssshho.....", ".....ohsseesseessho.....", ".....ohssssssssssho.....", ".....osssmmmmmmssso.....", ".....ossssddddsssso.....", "......oddddddddddo......", ".......owwwwwwwwo.......", "....occcccwoowccccco....", "...occccccCwwCcccccco...", "...occcccccwwccccccco...", "...occcccccccccccccco...", "...occcccccccccccccco...", "....occcccccccccccco....", ".....occcc....cccco.....", "........................", "........................", "........................"],
};
const BANG = ["rr", "rr", "rr", "rr", "..", "rr"];
// A candle: he keeps working after Jaime has gone.
const CANDLE = ["..y..", ".yYy.", "..w..", ".www.", ".aaa."];
const TRAY = ["..gg.gg.gg..", "waaaaaaaaaaw", ".oAAAAAAAAo."];

const PALETTES = {
  light: { o: "#14100e", c: "#262422", C: "#3d3936", w: "#f4f1e8", s: "#f2caa2", d: "#c99a6e",
           h: "#e2ded6", H: "#a9a49a", e: "#241a14", m: "#a49d92",
           a: "#cfd6dc", A: "#8e979f", g: "#e2ad35", r: "#c0453f", y: "#f0c14b", Y: "#fff0b8" },
  // Lifted coat plus a grey rim, so he reads as a butler and not a floating head.
  dark:  { o: "#6d675e", c: "#33302d", C: "#4a4643", w: "#f4f1e8", s: "#f2caa2", d: "#c99a6e",
           h: "#e8e4dc", H: "#9d988e", e: "#1a1410", m: "#b3aca1",
           a: "#dbe1e6", A: "#7d858c", g: "#efbb45", r: "#e5706b", y: "#ffd257", Y: "#fff6cf" },
};
let PAL = PALETTES.light;

function pickPalette() {
  const attr = document.documentElement.dataset.theme;
  const dark = attr === "dark" || (attr !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  PAL = dark ? PALETTES.dark : PALETTES.light;
}
pickPalette();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { pickPalette(); drawScene(); });


/** Paint one sprite onto any context, a pixel at a time. */
function stampOn(cx, rows, ox, oy, flip) {
  const w = rows[0].length;
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === ".") continue;
      const colour = PAL[ch];
      if (!colour) continue;
      cx.fillStyle = colour;
      cx.fillRect(ox + (flip ? w - 1 - x : x), oy + y, 1, 1);
    }
  })
}

/**
 * Where a ticket stands, drawn as a track with the butler standing on it.
 * Behind him the stops are filled; ahead of him they are hollow.
 */
const STAGES = ["planning", "plan_review", "in_progress", "verifying", "in_review", "accepted"];
const STAGE_LABELS = {
  planning: "plan", plan_review: "your ok", in_progress: "build",
  verifying: "verify", in_review: "your call", accepted: "done",
};

function stageOf(status) {
  const s = (status || "").toLowerCase();
  if (s === "open") return { index: 0, parked: false, started: false };
  if (s === "needs_input" || s === "blocked") return { index: 2, parked: true, started: true };
  if (s === "closed" || s === "accepted" || s === "done") return { index: 5, parked: false, started: true };
  const i = STAGES.indexOf(s);
  return { index: i === -1 ? 2 : i, parked: false, started: true };
}

function drawStageTrack(canvas, status) {
  pickPalette();
  const cx = canvas.getContext("2d");
  cx.imageSmoothingEnabled = false;
  cx.clearRect(0, 0, canvas.width, canvas.height);

  const { index, parked, started } = stageOf(status);
  const gap = 24, first = 13, trackY = 30;

  for (let i = 0; i < STAGES.length; i++) {
    const x = first + i * gap;
    if (i < STAGES.length - 1) {
      for (let dx = 2; dx < gap - 1; dx++) {
        cx.fillStyle = i < index ? PAL.g : PAL.H;
        cx.fillRect(x + dx, trackY, 1, 1);
      }
    }
    // A parked stop is marked red: he stopped there and is waiting on Jaime.
    cx.fillStyle = i < index ? PAL.g : i === index ? (parked ? PAL.r : PAL.o) : PAL.H;
    cx.fillRect(x - 1, trackY - 1, 3, 3);
    if (i === index) { cx.fillRect(x - 2, trackY - 2, 5, 1); cx.fillRect(x - 2, trackY + 2, 5, 1); }
  }

  // Parked: he stops and presents. Done: he bows. Otherwise he is walking it along.
  const pose = parked ? "stand" : index === 5 ? "bow" : started ? "walk" : "stand";
  stampOn(cx, SPRITES[pose], first + index * gap - 12, 3);
  if (parked) stampOn(cx, TRAY, first + index * gap - 6, 11);
}

function createButler(canvas, opts = {}) {
const pet = {
  x: 12, dir: 1, mood: "idle", pose: "stand",
  hold: 0,        // ticks left in the current pose
  blink: 0, t: 0, bounce: 0,
};

const cv = canvas;
const cx = cv.getContext("2d");
cx.imageSmoothingEnabled = false;

function px(x, y, colour) {
  cx.fillStyle = colour;
  cx.fillRect(x, y, 1, 1);
}

function stamp(rows, ox, oy, flip) {
  const w = rows[0].length;
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === ".") continue;
      const colour = PAL[ch];
      if (colour) px(ox + (flip ? w - 1 - x : x), oy + y, colour);
    }
  });
}

function drawScene() {
  cx.clearRect(0, 0, 48, 30);

  // a quiet dotted floor, so he is standing somewhere rather than nowhere
  for (let x = 1; x < 47; x += 3) px(x, 27, PAL.H);

  const bounce = pet.mood === "alarm" ? (pet.t % 4 < 2 ? -2 : 0)
               : pet.mood === "attention" ? (pet.t % 10 < 5 ? -1 : 0)
               : (pet.pose === "walk" && pet.t % 2 === 0) ? -1 : 0;
  const y = 3 + bounce;

  // contact shadow, tightened when he lifts off
  const shadow = bounce ? 8 : 10;
  for (let i = 0; i < shadow; i++) px(pet.x + 7 + i + (10 - shadow) / 2, 26, PAL.H);

  // he turns to face you the moment he needs something
  const facing = (pet.mood === "attention" || pet.mood === "alarm") ? false : pet.dir < 0;
  let pose = pet.pose;
  if (pet.blink > 0) pose = "blink";
  stamp(SPRITES[pose] || SPRITES.stand, pet.x, y, facing);

  // The tray only appears when he actually has something for you. A butler
  // holding one out permanently says nothing; holding one out *now* does.
  if (pet.mood === "attention") {
    const wobble = pet.t % 8 < 4 ? 0 : 1;
    stamp(TRAY, pet.x + 6, y + 11 + wobble, false);
  }

  // Something is wrong: no offering, just the mark, blinking beside his head.
  if (pet.mood === "alarm" && pet.t % 6 < 4) {
    stamp(BANG, pet.x + 20, y + 2, false);
  }

  // After hours he carries a candle, and the flame gutters. Jaime is not here;
  // this is the shift where nothing is asked of him.
  if (pet.mood === "night") {
    stamp(pet.t % 10 < 5 ? CANDLE : CANDLE.map((r, i) => (i === 1 ? ".y.y." : r)), pet.x + (pet.dir < 0 ? -3 : 22), y + 12, false);
  }
}

const MOODS = {
  idle:      { text: "all quiet" },
  night:     { text: "after hours" },
  busy:      { text: "working" },
  attention: { text: "needs you" },
  alarm:     { text: "check the board" },
};

function setMoodFromBoard(d) {
  const failed = d.workers.filter((w) => w.state === "failed").length;
  const blocked = d.workers.filter((w) => w.state === "blocked").length;
  const working = d.workers.filter((w) => w.state === "working").length;

  let mood = "idle", text = MOODS.idle.text;
  if (failed || d.anomalies.length) {
    mood = "alarm";
    text = failed ? `${failed} worker${failed > 1 ? "s" : ""} failed` : "something is off";
  } else if (d.questions.length || d.plans.length || d.accept.length || blocked) {
    mood = "attention";
    const n = d.questions.length + d.plans.length + d.accept.length || blocked;
    text = `${n} waiting on you`;
  } else if (working) {
    mood = "busy";
    text = `${working} working`;
  }

  pet.mood = mood;
  opts.onMood?.(mood, text);
}

function tick() {
  pet.t++;
  if (pet.blink > 0) pet.blink--;
  else if (Math.random() < 0.03) pet.blink = 2;

  // Waiting on you, or something is wrong: he stops where he is and faces you.
  // Standing still is the signal; wandering off would undercut it.
  if (pet.mood === "attention" || pet.mood === "alarm") {
    pet.pose = "stand";
    pet.hold = 0;
    drawScene();
    return;
  }

  // The night shift: slow, steady, and he never turns to face you, because
  // there is no one to face.
  if (pet.mood === "night") {
    if (pet.t % 2 === 0) {
      if (pet.hold > 0) pet.hold--;
      else if (pet.pose === "walk") {
        pet.x += pet.dir;
        if (pet.x <= 1) { pet.x = 1; pet.dir = 1; }
        if (pet.x >= 23) { pet.x = 23; pet.dir = -1; }
        if (Math.random() < 0.05) { pet.pose = "stand"; pet.hold = 12; }
      } else if (Math.random() < 0.3) {
        pet.pose = "walk";
      }
    }
    drawScene();
    return;
  }

  if (pet.hold > 0) {
    pet.hold--;
  } else if (pet.pose === "walk") {
    pet.x += pet.dir;
    if (pet.x <= 1) { pet.x = 1; pet.dir = 1; }
    if (pet.x >= 23) { pet.x = 23; pet.dir = -1; }
    // Busy keeps moving; idle stops to look around.
    if (pet.mood === "idle" && Math.random() < 0.08) { pet.pose = "stand"; pet.hold = 10 + (Math.random() * 20 | 0); }
  } else {
    const wander = pet.mood === "busy" ? 0.7 : 0.12;
    if (Math.random() < wander) {
      pet.pose = "walk";
      if (Math.random() < 0.4) pet.dir *= -1;
    } else if (Math.random() < 0.06) {
      pet.pose = "bow"; pet.hold = 6;
    } else if (Math.random() < 0.12) {
      pet.dir *= -1;                    // a glance the other way
    }
  }
  if (pet.pose === "bow" && pet.hold === 0) pet.pose = "stand";

  drawScene();
}

opts.screen?.addEventListener("click", () => {   // a butler bows when greeted
  pet.pose = "bow";
  pet.hold = 6;
  drawScene();
});

drawScene();
setInterval(tick, 130);   // 8fps, the way these things moved
  /** For pages that are not the fleet board, e.g. the morning brief. */
  function setMood(mood, text) {
    pet.mood = mood;
    opts.onMood?.(mood, text);
    drawScene();
  }

  return { setMood, setMoodFromBoard, moodOf: () => pet.mood, pet };
}

