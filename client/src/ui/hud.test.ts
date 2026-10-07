import { test } from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../i18n/index.ts";
import { absBadge, gapText, gearLabel, lapOf, launchReady, liveParts, rpmFill, tcBadge } from "./hud.ts";
import { launchRPM } from "../car/car.ts";
import { fastest, resultCells } from "./results.ts";

test("lap shown: completed + 1, capped at the race distance", () => {
  assert.equal(lapOf(0, 3), 1);
  assert.equal(lapOf(2, 3), 3);
  assert.equal(lapOf(3, 3), 3);
});

test("gap texts: seconds or laps", () => {
  setLang("en", null);
  assert.equal(gapText({ id: 1, ms: 1234, laps: 0 }), "1.2");
  assert.equal(gapText({ id: 1, ms: 0, laps: 1 }), "+1 lap");
  assert.equal(gapText({ id: 1, ms: 0, laps: 2 }), "+2 laps");
  setLang("tr", null);
  assert.equal(gapText({ id: 1, ms: 0, laps: 2 }), "+2 tur");
});

test("rpm bar fill", () => {
  assert.equal(rpmFill(4000), 0);
  assert.equal(rpmFill(13500), 1);
  assert.equal(rpmFill(20000), 1);
  assert.equal(rpmFill(8750), 0.5);
  assert.equal(rpmFill(NaN), 0);
});

test("results: DNF marking, fastest lap", () => {
  setLang("en", null);
  const row = { pos: 1, id: 4, name: "Ace", laps: 3, total: 245678, best: 80123, penalty: 5000 };
  assert.deepEqual(resultCells(row), { pos: "1", name: "Ace", laps: "3", total: "4:05.678", best: "1:20.123", penalty: "+5 s", dnf: false });
  const dnf = resultCells({ ...row, pos: 10, total: 0, best: 0, penalty: 0, laps: 1 });
  assert.equal(dnf.dnf, true);
  assert.equal(dnf.pos, "DNF");
  assert.equal(dnf.total, "DNF");
  assert.equal(dnf.best, "-:--.---");
  assert.equal(fastest([row, { ...row, best: 79000 }, { ...row, best: 0 }]), 79000);
  assert.equal(fastest([]), 0);
  setLang("tr", null);
  assert.equal(resultCells(row).penalty, "+5 sn");
});

test("gear R in reverse, the launch bar at the launch rpm, the TC badge", () => {
  assert.equal(gearLabel(0), "R");
  assert.equal(gearLabel(3), "3");
  assert.equal(launchReady(launchRPM), true);
  assert.equal(launchReady(8000), false);
  setLang("en", null);
  assert.equal(tcBadge(2), "TC 2");
  assert.equal(tcBadge(0), "TC OFF");
  setLang("tr", null);
  assert.equal(tcBadge(0), "TC KAPALI");
});

test("the live readout: BB 58.0 · TC 1 · ABS 1 · DIFF 5; Arcade TC/ABS A; off levels", () => {
  setLang("en", null);
  assert.deepEqual(liveParts([6, 6, 58, 3, 5, 5, 1, 1], false), ["BB 58.0", "TC 1", "ABS 1", "DIFF 5"]);
  assert.deepEqual(liveParts([6, 6, 63, 3, 9, 5, 0, 0], false), ["BB 63.0", "TC OFF", "ABS OFF", "DIFF 9"]);
  assert.deepEqual(liveParts([6, 6, 58, 3, 5, 5, 0, 2], true), ["BB 58.0", "TC A", "ABS A", "DIFF 5"]);
  assert.equal(absBadge(3), "ABS 3");
  setLang("tr", null);
  assert.deepEqual(liveParts([6, 6, 58, 3, 5, 5, 2, 0], false), ["FD 58,0", "TC 2", "ABS KAPALI", "DİF 5"]);
});
