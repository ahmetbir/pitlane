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
  assert.deepEqual(await fetchLaps("week", reply(200, { week: "W", top: [{ name: "A", ms: 80000 }, { name: "B", ms: 0 }, { ms: 1 }] })), { week: "W", top: [{ name: "A", ms: 80000 }] });
  assert.equal(await fetchLaps("all", reply(503, { code: "stats_off" })), "off");
  assert.equal(await fetchLaps("all", reply(500, {})), null);
  assert.equal(await fetchLaps("all", async () => { throw new Error("down"); }), null);
});

test("me: the token goes in X-Pilot-Token; null pilot, stats off and bad bodies", async () => {
  let sent: Record<string, string> = {};
  const reply = (status: number, body: unknown): Fetch => async (_u, i) => {
    sent = (i.headers ?? {}) as Record<string, string>;
    return new Response(JSON.stringify(body), { status });
  };
  const card = { name: "Ace", races: 4, wins: 1, podiums: 2, laps: 12, best: { kiyi: 79123 } };
  assert.deepEqual(await fetchMe("tok", reply(200, { pilot: card })), { ...card, best: 79123 });
  assert.deepEqual(sent, { "X-Pilot-Token": "tok" });
  assert.equal(await fetchMe("tok", reply(200, { pilot: null })), "none");
  assert.equal(await fetchMe("tok", reply(503, { code: "stats_off" })), "off");
  assert.equal(await fetchMe("tok", reply(200, { pilot: { name: 3 } })), null);
  assert.equal(await fetchMe("", reply(200, { pilot: card })), "none", "no token: no request");
  assert.deepEqual(parseMe({ pilot: { ...card, best: {} } }), { ...card, best: 0 });
});
