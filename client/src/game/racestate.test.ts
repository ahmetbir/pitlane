import { test } from "node:test";
import assert from "node:assert/strict";
import type { ServerMsg } from "../net/protocol.ts";
import { kiyi } from "../track/track.ts";
import { RaceState } from "./racestate.ts";

const tr = kiyi();
const L = tr.length;

/** A cars row at track distance s (on the centre line), lap, flags. */
function row(id: number, s: number, lap = 0, flags = 0): number[] {
  const [x, z] = tr.point(((s % L) + L) % L, 0);
  return [id, Math.round(x * 100), Math.round(z * 100), 0, 0, 0, 0, 0, lap, Math.round((((s % L) + L) % L) * 10), flags];
}
const snap = (phase: "lights" | "racing" | "finish", clock: number, cars: number[][]): ServerMsg => ({ t: "snap", tick: 1, ack: 0, phase, clock, cars });

test("HUD from fake messages: position, lap, gaps with names, off track", () => {
  const rs = new RaceState(tr, 3, () => 2);
  rs.apply({ t: "grid", creator: 2, cars: [{ id: 1, name: "Bot Ada", bot: true, ready: false }, { id: 2, name: "Ace", bot: false, ready: true }, { id: 3, name: "Bot Cem", bot: true, ready: false }] });
  rs.apply(snap("lights", 0, [row(1, L - 10), row(2, L - 18), row(3, L - 26)]));
  let v = rs.hud(null);
  assert.equal(v.pos, 2);
  assert.equal(v.cars, 3);
  assert.equal(v.lap, 1);
  assert.equal(v.current, 0);
  // 50 m/s each, the grid order kept: 8 m apart = 160 ms.
  for (let t = 100; t <= 8000; t += 100) {
    const d = (t / 1000) * 50;
    rs.apply(snap("racing", t, [row(1, L - 10 + d), row(2, L - 18 + d, 0, t === 8000 ? 8 : 0), row(3, L - 26 + d)]));
  }
  v = rs.hud(null);
  assert.equal(v.pos, 2);
  assert.equal(v.ahead?.name, "Bot Ada");
  assert.ok(Math.abs(v.ahead!.gap.ms - 160) < 1, `ahead ${v.ahead?.gap.ms}`);
  assert.equal(v.behind?.name, "Bot Cem");
  assert.ok(Math.abs(v.behind!.gap.ms - 160) < 1);
  assert.equal(v.current, 8000);
  assert.equal(v.offTrack, true);
  assert.equal(v.wrongWay, false, "no drawn car: no wrong-way check");
});

test("lap messages for the own car drive last and best; other cars' do not", () => {
  const rs = new RaceState(tr, 3, () => 2);
  rs.apply(snap("lights", 0, [row(2, L - 18)]));
  rs.apply({ t: "lap", car: 1, lap: 1, ms: 70000, valid: true, best: 70000 });
  rs.apply({ t: "lap", car: 2, lap: 1, ms: 81234, valid: true, best: 81234 });
  rs.apply(snap("racing", 82000, [row(2, L + 30, 1)]));
  const v = rs.hud(null);
  assert.equal(v.last, 81234);
  assert.equal(v.best, 81234);
  assert.equal(v.lap, 2);
  assert.equal(v.current, 82000 - 81234);
});

test("wrong way: driving against the track direction", () => {
  const rs = new RaceState(tr, 3, () => 2);
  rs.apply(snap("lights", 0, [row(2, 500)]));
  rs.apply(snap("racing", 100, [row(2, 500)]));
  const seg = tr.segs[250];
  const st = { x: seg.x, z: seg.z, h: 0, hx: -seg.tx, hz: -seg.tz, vx: 30, vy: 0, r: 0, delta: 0, rpm: 9000, gear: 4, ax: 0, launch: false, dmg: { frontWing: 0, rearWing: 0, susp: 0 } };
  assert.equal(rs.hud(st).wrongWay, true);
  assert.equal(rs.hud({ ...st, hx: seg.tx, hz: seg.tz }).wrongWay, false);
  assert.equal(rs.hud({ ...st, vx: 2 }).wrongWay, false, "creeping: no warning");
});

test("a reconnect into the same car keeps last, best and position; a new car starts over", () => {
  const welcome = (car: number): ServerMsg => ({
    t: "welcome", you: 1, code: "K3FQ", car, handling: "arcade", contact: "soft", laps: 3, track: "kiyi", creator: false,
    setup: [6, 6, 58, 3, 5, 5, 1], dmg: { fw: 0, rw: 0, su: 0 },
  });
  let own = 2;
  const rs = new RaceState(tr, 3, () => own);
  rs.apply(welcome(2));
  rs.apply(snap("lights", 0, [row(2, L - 18)]));
  rs.apply({ t: "lap", car: 2, lap: 1, ms: 81234, valid: true, best: 81234 });
  rs.apply(snap("racing", 82000, [row(2, L + 30, 1)]));
  rs.apply(welcome(2));
  rs.apply(snap("racing", 90000, [row(2, L + 400, 1)]));
  let v = rs.hud(null);
  assert.equal(v.best, 81234);
  assert.equal(v.current, 90000 - 81234, "the lap clock runs on");
  own = 5;
  rs.apply(welcome(5));
  rs.apply(snap("racing", 91000, [row(2, L + 450, 1), row(5, L + 100, 1)]));
  v = rs.hud(null);
  assert.equal(v.best, 0, "another car: its history is unknown");
  assert.equal(v.current, null);
});
