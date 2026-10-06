import { test } from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../i18n/index.ts";
import { gapText, lapOf, rpmFill } from "./hud.ts";
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
