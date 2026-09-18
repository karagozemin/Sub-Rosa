import assert from "node:assert/strict";
import test from "node:test";

import { pilotRevealAction } from "./pilotReveal.js";

test("keeps an open round locked until its Drand round is published", () => {
  assert.deepEqual(pilotRevealAction("Open", false, 102), {
    visible: true,
    ready: false,
    label: "Reveal in 1:42",
  });
});

test("enables reveal once the Drand round is published", () => {
  assert.deepEqual(pilotRevealAction("Open", true, 0), {
    visible: true,
    ready: true,
    label: "Open + reveal",
  });
});

test("keeps a revealing round actionable for unfinished submissions", () => {
  assert.deepEqual(pilotRevealAction("Revealing", false, 30), {
    visible: true,
    ready: true,
    label: "Reveal submissions",
  });
});

test("disables the action when every submission is already revealed", () => {
  assert.deepEqual(pilotRevealAction("Revealing", true, 0, true), {
    visible: true,
    ready: false,
    label: "Reveal complete",
  });
});

test("hides reveal action after the reveal phase", () => {
  assert.equal(pilotRevealAction("Cleared", true, 0).visible, false);
});


test("owner opening respects privacy, wallet authorization, fallback and deadline", () => {
  const window = { controller: "owner", caller: "bidder", fallbackAt: 100, now: 99, revealDeadline: 400 };
  assert.equal(pilotRevealAction("Open", true, 0, false, window).ready, false);
  assert.equal(pilotRevealAction("Open", true, 0, false, { ...window, caller: "owner" }).ready, true);
  assert.equal(pilotRevealAction("Open", false, 1, false, { ...window, caller: "owner" }).ready, false);
  assert.equal(pilotRevealAction("Open", true, 0, false, { ...window, now: 100 }).ready, true);
  assert.equal(pilotRevealAction("Revealing", true, 0, false, window).ready, true);
  assert.equal(pilotRevealAction("Open", true, 0, false, { ...window, now: 401 }).visible, false);
});
