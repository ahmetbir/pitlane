import { test } from "node:test";
import assert from "node:assert/strict";
import { Standings, type Mark } from "./standings.ts";

const L = 1000;
const SECTORS = [0, 300, 600];
const mark = (id: number, s: number, lap = 0, finished = false): Mark => ({ id, s, lap, finished });

test("grid behind the line: order by distance, unwrapped across the line", () => {
  const st = new Standings(L, SECTORS, () => 2);
  st.push(0, [mark(1, 990), mark(2, 980), mark(3, 970)]);
  assert.deepEqual(st.order(), [1, 2, 3]);
  assert.equal(st.progressOf(1), -10);
  st.push(1000, [mark(1, 30), mark(2, 5), mark(3, 995)]);
  assert.deepEqual(st.order(), [1, 2, 3]);
  assert.equal(st.progressOf(2), 5);
  assert.equal(st.progressOf(3), -5);
  assert.equal(st.position(2), 2);
  assert.equal(st.position(9), 0);
});

test("finishers lead in the order they finished", () => {
  const st = new Standings(L, SECTORS, () => 1);
  st.push(0, [mark(1, 900, 2), mark(2, 800, 2)]);
  st.push(100, [mark(1, 950, 2), mark(2, 10, 3, true)]);
  assert.deepEqual(st.order(), [2, 1]);
  st.push(200, [mark(1, 20, 3, true), mark(2, 60, 3, true)]);
  assert.deepEqual(st.order(), [2, 1]);
});

test("gaps: time since the car ahead passed my spot, and since I passed the car behind's", () => {
  const st = new Standings(L, SECTORS, () => 2);
  // Every car at 50 m/s; car 1 is 100 m (2 s) ahead of car 2, car 3 50 m (1 s) behind it.
  for (let t = 0; t <= 6000; t += 100) {
    const d = (t / 1000) * 50;
    st.push(t, [mark(1, 100 + d), mark(2, d), mark(3, (L - 50 + d) % L)]);
  }
  const g = st.gaps(2);
  assert.equal(g.ahead?.id, 1);
  assert.ok(Math.abs(g.ahead!.ms - 2000) < 1, `ahead ${g.ahead?.ms}`);
  assert.equal(g.behind?.id, 3);
  assert.ok(Math.abs(g.behind!.ms - 1000) < 1, `behind ${g.behind?.ms}`);
  assert.equal(st.gaps(1).ahead, null, "the leader has nobody ahead");
  assert.equal(st.gaps(3).behind, null, "last has nobody behind");
});

test("a lapped car shows laps, not time", () => {
  const st = new Standings(L, SECTORS, () => 2);
  st.push(0, [mark(1, 500, 3), mark(2, 400, 2)]);
  st.push(100, [mark(1, 510, 3), mark(2, 410, 2)]);
  assert.deepEqual(st.gaps(2).ahead, { id: 1, ms: 0, laps: 1 });
  assert.deepEqual(st.gaps(1).behind, { id: 2, ms: 0, laps: 1 });
});

test("sector colours: purple fastest of all, green own best, yellow slower", () => {
  let own = 1;
  const st = new Standings(L, SECTORS, () => own);
  const drive = (id: number, from: number, to: number, t0: number, v: number) => {
    // v m/ms from progress `from` to `to`, snapshots every 10 ms
    for (let p = from, t = t0; p <= to; p += v * 10, t += 10) st.push(t, [mark(id, ((p % L) + L) % L, Math.max(0, Math.floor(p / L)))]);
  };
  // Own car 1 alone: lap 1 from the line at 0.1 m/ms → S1 3000 ms, purple.
  drive(1, 0, 310, 0, 0.1);
  assert.deepEqual([...st.sectors()], ["purple", "", ""]);
  drive(1, 310, 610, 3100, 0.05);
  assert.deepEqual([...st.sectors()], ["purple", "purple", ""]);
  own = 2; // the next pushes time car 1 as someone else; car 2 is not seen yet
  assert.equal(st.position(1), 1);
});

test("own sectors: a slower repeat is yellow, a faster one purple", () => {
  const st = new Standings(L, SECTORS, () => 1);
  let t = 0;
  const lap = (id: number, msPerSector: number[], startLap: number) => {
    // Teleport-free: advance in 10 m steps through one lap.
    for (let k = 0; k < 3; k++) {
      const v = 300 / msPerSector[k];
      const from = startLap * L + SECTORS[k], to = startLap * L + (k === 2 ? L : SECTORS[k + 1]);
      for (let p = from + 10; p <= to; p += 10) {
        t += 10 / v;
        st.push(t, [mark(id, p % L, Math.floor(p / L))]);
      }
    }
  };
  st.push(0, [mark(1, 0, 0)]);
  lap(1, [3000, 3000, 3000], 0); // 400 m S3 at 300/3000 m/ms = 4000 ms
  assert.deepEqual([...st.sectors()], ["purple", "purple", "purple"]);
  lap(1, [3500, 2900, 3100], 1);
  assert.deepEqual([...st.sectors()], ["yellow", "purple", "yellow"]);
});

test("a personal best slower than another car's sector is green; a car first seen mid-sector is not timed", () => {
  const st = new Standings(L, SECTORS, () => 1);
  // Car 2 runs S1 in 2000 ms, the own car 1 in 3000 ms, both from the line at clock 0.
  st.push(0, [mark(1, 0), mark(2, 0)]);
  for (let t = 100; t <= 3000; t += 100) st.push(t, [mark(1, (t / 3000) * 300), mark(2, Math.min(t / 2000, 1.4) * 300)]);
  assert.equal(st.sectors()[0], "green");
  const late = new Standings(L, SECTORS, () => 1);
  late.push(500, [mark(1, 100)]);
  late.push(1500, [mark(1, 310)]);
  assert.equal(late.sectors()[0], "", "no start seen: the partial sector is not timed");
});
