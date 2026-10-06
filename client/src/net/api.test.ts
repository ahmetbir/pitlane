import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchLaps, parseBoard, parseRooms, type Fetch } from "./api.ts";

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
