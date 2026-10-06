import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDelta, fmtGap, fmtLap, fmtTime, kmh } from "./fmt.ts";

test("lap times: m:ss.mmm, blank when missing", () => {
  assert.equal(fmtLap(83456), "1:23.456");
  assert.equal(fmtLap(59123), "0:59.123");
  assert.equal(fmtLap(600000), "10:00.000");
  assert.equal(fmtLap(61001.4), "1:01.001");
  assert.equal(fmtLap(0), "-:--.---");
  assert.equal(fmtLap(-5), "-:--.---");
  assert.equal(fmtLap(NaN), "-:--.---");
  assert.equal(fmtTime(0), "0:00.000");
  assert.equal(fmtTime(999.6), "0:01.000");
});

test("delta: signed with a true minus", () => {
  assert.equal(fmtDelta(123), "+0.123");
  assert.equal(fmtDelta(-45), "−0.045");
  assert.equal(fmtDelta(0), "+0.000");
  assert.equal(fmtDelta(-1234.4), "−1.234");
  assert.equal(fmtDelta(61000), "+61.000");
});

test("gaps: tenths, minutes past 60 s", () => {
  assert.equal(fmtGap(1234), "1.2");
  assert.equal(fmtGap(49), "0.0");
  assert.equal(fmtGap(50), "0.1");
  assert.equal(fmtGap(59960), "1:00.0");
  assert.equal(fmtGap(61234), "1:01.2");
  assert.equal(fmtGap(-300), "0.0");
});

test("speed", () => {
  assert.equal(kmh(27.78), 100);
  assert.equal(kmh(-10), 36);
  assert.equal(kmh(NaN), 0);
});
