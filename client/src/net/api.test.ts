import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchLaps, fetchMe, parseBoard, parseMe, parseRooms, type Fetch } from "./api.ts";

const room = { code: "K3FQ", handling: "sim", contact: "full", laps: 5, humans: 2, seats: 10, phase: "racing", lap: 3 };

test("rooms: well-formed rows only", () => {
  assert.deepEqual(parseRooms({ rooms: [room] }), [room]);
  assert.deepEqual(parseRooms({ rooms: [{ ...room, code: "k3fq" }, { ...room, handling: "kart" }, { ...room, phase: "ended" }, { ...room, lap: -1 }, null] }), []);
  assert.deepEqual(parseRooms({}), []);
  assert.deepEqual(parseRooms(null), []);
});

test("boards: rows validated, stats off is its own answer", async () => {
  assert.deepEqual(parseBoard({ week: "2026-W41", top: [{ name: "A", ms: 80000 }, { name: "B", ms: 0 }] }, (v) => v as { name: string; ms: number })?.top.length, 2);
  const reply = (status: number, body: unknown): Fetch => async () => new Response(JSON.stringify(body), { status });
  assert.deepEqual(await fetchLaps("week", "arcade", reply(200, { week: "W", top: [{ name: "A", ms: 80000 }, { name: "B", ms: 0 }, { ms: 1 }] })), { week: "W", top: [{ name: "A", ms: 80000 }] });
  assert.equal(await fetchLaps("all", "sim", reply(503, { code: "stats_off" })), "off");
  assert.equal(await fetchLaps("all", "sim", reply(500, {})), null);
  assert.equal(await fetchLaps("all", "arcade", async () => { throw new Error("down"); }), null);
});

test("lap boards: one per handling", async () => {
  const urls: string[] = [];
  const spy: Fetch = async (u) => (urls.push(u), new Response(JSON.stringify({ week: "W", top: [] }), { status: 200 }));
  await fetchLaps("week", "arcade", spy);
  await fetchLaps("all", "sim", spy);
  assert.deepEqual(urls, ["/api/leaderboard?period=week&key=kiyi-arcade", "/api/leaderboard?period=all&key=kiyi-sim"]);
});

test("me: the token goes in X-Pilot-Token; null pilot, stats off and bad bodies", async () => {
  let sent: Record<string, string> = {};
  const reply = (status: number, body: unknown): Fetch => async (_u, i) => {
    sent = (i.headers ?? {}) as Record<string, string>;
    return new Response(JSON.stringify(body), { status });
  };
  const card = { name: "Ace", races: 4, wins: 1, podiums: 2, laps: 12, best: { "kiyi-arcade": 71123, "kiyi-sim": 76456, kiyi: 1 } };
  assert.deepEqual(await fetchMe("tok", reply(200, { pilot: card })), { ...card, best: { arcade: 71123, sim: 76456 } });
  assert.deepEqual(sent, { "X-Pilot-Token": "tok" });
  assert.equal(await fetchMe("tok", reply(200, { pilot: null })), "none");
  assert.equal(await fetchMe("tok", reply(503, { code: "stats_off" })), "off");
  assert.equal(await fetchMe("tok", reply(200, { pilot: { name: 3 } })), null);
  assert.equal(await fetchMe("", reply(200, { pilot: card })), "none", "no token: no request");
  assert.deepEqual(parseMe({ pilot: { ...card, best: {} } }), { ...card, best: { arcade: 0, sim: 0 } });
  assert.deepEqual(parseMe({ pilot: { ...card, best: { "kiyi-sim": -1 } } }), { ...card, best: { arcade: 0, sim: 0 } });
});
