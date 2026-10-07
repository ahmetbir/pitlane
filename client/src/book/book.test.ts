import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ABS, defaultSetup, Handling, launchRPM, newParams, noDamage, setupMax, setupMin, assistShares } from "../car/car.ts";
import { zeroTo100 } from "../car/measure.ts";
import { setLang } from "../i18n/index.ts";
import { defaultBindings, keyRows, padRows, rebind, type Bindings } from "../input/bindings.ts";
import { lastChapter } from "./book.ts";
import { CHAPTERS } from "./chapters.ts";
import { fixed } from "./kit.ts";
import { RULES } from "./rules.ts";

// A minimal DOM: elements with attributes and children, text nodes; enough for h(), s() and the chapters.
class FakeNode {
  children: FakeNode[] = [];
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  readonly tag: string;
  private text: string;
  constructor(tag: string, text = "") {
    this.tag = tag;
    this.text = text;
  }
  appendChild(c: FakeNode) { this.children.push(c); return c; }
  append(...cs: FakeNode[]) { this.children.push(...cs); }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  addEventListener() {}
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this.text = v; }
}
Object.assign(globalThis, {
  document: {
    createElement: (t: string) => new FakeNode(t),
    createElementNS: (_ns: string, t: string) => new FakeNode(t),
    createTextNode: (t: string) => new FakeNode("#text", t),
  },
});

const textOf = (id: string, keys: Bindings = defaultBindings()) =>
  CHAPTERS.find((c) => c.id === id)!.render({ keys }).map((n) => n.textContent).join(" ");

/** A Go constant's value: `name = 30 * tps` → 1800 (tps = 60), `name = 0.6` → 0.6. */
function goConst(file: string, name: string): number {
  const src = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
  const m = new RegExp(`^\\s*${name}\\s*=\\s*([0-9.]+)(\\s*\\*\\s*tps)?\\s*(//.*)?$`, "m").exec(src);
  assert.ok(m, `${file}: ${name} not found`);
  return Number(m[1]) * (m[2] ? 60 : 1);
}

test("the race rules match the Go server and the race page", () => {
  const race = "internal/race/phase.go", car = "internal/car/car.go";
  assert.equal(goConst(race, "humanGridTicks"), RULES.humanGridS * 60);
  assert.equal(goConst(race, "lightCount"), RULES.lightCount);
  assert.equal(goConst(race, "lightTicks"), RULES.lightS * 60);
  assert.equal(goConst(race, "jumpStartMeters"), RULES.jumpStartM);
  assert.equal(goConst(race, "jumpStartPenMs"), RULES.jumpStartPenS * 1000);
  assert.equal(goConst("internal/race/timing.go", "maxOffTicks"), RULES.offTrackS * 60);
  assert.equal(goConst(race, "resetSpeed"), RULES.resetSpeed);
  assert.equal(goConst(race, "resetTicks"), RULES.resetS * 60);
  assert.equal(goConst(race, "drivableCos"), Math.cos((RULES.drivableDeg * Math.PI) / 180));
  assert.equal(goConst(race, "holdMax"), RULES.holdMaxS * 60);
  assert.equal(goConst(race, "dropBack"), RULES.dropBackM);
  assert.equal(goConst(race, "finishMaxTicks"), RULES.finishWindowS * 60);
  assert.equal(goConst(race, "lapCapTicks"), RULES.lapCapS * 60);
  assert.equal(goConst(race, "resultsTicks"), RULES.resultsS * 60);
  assert.equal(goConst(race, "reconnectTicks"), RULES.reconnectS * 60);
  assert.equal(goConst(race, "numCars"), RULES.cars);
  assert.equal(goConst(car, "wingLost"), RULES.wingLost);
  assert.equal(goConst(car, "lostWingCL"), RULES.lostWingCL);
  assert.equal(goConst(car, "suspLoss"), RULES.suspLoss);
  const app = readFileSync(new URL("../ui/app.ts", import.meta.url), "utf8");
  assert.match(app, new RegExp(`IDLE_LEAVE_S = ${RULES.idleLeaveS / 60} \\* 60;`));
});

test("every chapter renders in both languages; ids are unique", () => {
  assert.equal(new Set(CHAPTERS.map((c) => c.id)).size, CHAPTERS.length);
  for (const l of ["tr", "en"] as const) {
    setLang(l, null);
    for (const c of CHAPTERS) assert.ok(textOf(c.id).length > 300, `${l} ${c.id}`);
  }
  setLang("tr", null);
});

test("the manual quotes the code's numbers", () => {
  setLang("en", null);
  try {
    const start = textOf("baslarken");
    assert.ok(start.includes(`Up to ${RULES.cars} cars`) && start.includes("(3, 5, 8)") && start.includes(`${RULES.reconnectS} s`));
    const controls = textOf("kontroller");
    assert.ok(controls.includes("about 29 km/h"), "reverse top speed from revTop");
    const handling = textOf("arcade-sim");
    for (const share of assistShares.slice(1)) assert.ok(handling.includes(`${Math.round(share * 100)}%`), `share ${share}`);
    for (let tc = 0; tc <= 3; tc++) assert.ok(handling.includes(`${fixed(zeroTo100(Handling.Sim, tc), 2)} s`), `TC ${tc} 0–100`);
    assert.ok(handling.includes("grip 25% more"), "Arcade grip from the params");
    assert.equal(newParams(Handling.Arcade, defaultSetup(), noDamage()).tcShare, assistShares[3], "Arcade TC: Sim level 3's share");
    assert.ok(handling.includes(`share is Sim level 3's (${Math.round(assistShares[3] * 100)}%)`));
    const garage = textOf("garaj");
    assert.ok(garage.includes(`${setupMin[0]} … ${setupMax[0]}`) && garage.includes("50 : 50 … 70 : 30") && garage.includes("Off … 3"));
    assert.ok(garage.includes(`${defaultSetup()[2]} : ${100 - defaultSetup()[2]}`), "the default brake bias");
    const race = textOf("yaris");
    for (const s of [`${RULES.jumpStartM} m`, `${RULES.jumpStartPenS} s`, `${RULES.offTrackS} s`, `${RULES.finishWindowS} s`, `${RULES.drivableDeg}°`]) assert.ok(race.includes(s), s);
    assert.ok(race.includes(`JUMP START · +${RULES.jumpStartPenS} s penalty`) && race.includes(`+${RULES.jumpStartPenS} s badge`), "the jump-start banner and badge");
    assert.ok(handling.includes("ABS levels") && handling.includes("Grip left to the brakes"), "the ABS table");
    assert.ok(handling.includes(`level-1 share (${Math.round(newParams(Handling.Arcade, defaultSetup(), noDamage()).absShare * 100)}%)`), "Arcade ABS from the params");
    assert.ok(handling.includes(`the default is ${defaultSetup()[ABS]}`), "Sim ABS default from the setup");
    assert.ok(garage.includes("Off … 3") && garage.includes("Arcade always runs at 1"), "the garage has its ABS section");
    for (const k of ["1 / 2", "3 / 4", "5 / 6", "7 / 8"]) assert.ok(controls.includes(k), `live keys ${k}`);
    assert.ok(controls.includes("Changing settings while racing"));
    const launch = textOf("kalkis");
    assert.ok(launch.includes(`${launchRPM} rpm`));
    const gain = zeroTo100(Handling.Arcade, 3) - zeroTo100(Handling.Arcade, 3, true);
    assert.ok(gain > 0.15 && launch.includes(`−${fixed(gain, 2)} s`), "the Arcade launch gain, measured");
  } finally {
    setLang("tr", null);
  }
});

test("the controls chapter lists the player's own bindings and the gamepad", () => {
  for (const l of ["tr", "en"] as const) {
    setLang(l, null);
    const keys = rebind(defaultBindings(), "brake", 0, "KeyB");
    const text = textOf("kontroller", keys);
    for (const [k, what] of [...keyRows(keys), ...padRows()]) assert.ok(text.includes(k) && text.includes(what), `${l} ${k}`);
    assert.ok(textOf("kalkis", keys).includes("B + W"), "the launch chord follows a rebind");
  }
  setLang("tr", null);
});

test("the last chapter is remembered by id", () => {
  assert.equal(lastChapter(CHAPTERS, { getItem: () => "temas" }), CHAPTERS.findIndex((c) => c.id === "temas"));
  assert.equal(lastChapter(CHAPTERS, { getItem: () => "nope" }), 0);
  assert.equal(lastChapter(CHAPTERS, { getItem: () => { throw new Error("blocked"); } }), 0);
});

test("English has the Turkish structure and no Turkish left", () => {
  const shape = (nodes: Node[]) => {
    const count: Record<string, number> = {};
    const walk = (n: FakeNode) => {
      if (["h3", "figure", "table", "tr", "ul", "ol", "li", "svg", "kbd"].includes(n.tag)) count[n.tag] = (count[n.tag] ?? 0) + 1;
      n.children.forEach(walk);
    };
    (nodes as unknown as FakeNode[]).forEach(walk);
    return count;
  };
  setLang("tr", null);
  const keys = defaultBindings();
  const tr = CHAPTERS.map((c) => [c.title(), shape(c.render({ keys }))] as const);
  setLang("en", null);
  try {
    CHAPTERS.forEach((c, i) => {
      assert.notEqual(c.title(), tr[i][0], `${c.id} title`);
      assert.deepEqual(shape(c.render({ keys })), tr[i][1], c.id);
      const text = textOf(c.id);
      assert.ok(!/[çğıİöşüÇĞÖŞÜ]/.test(text), `${c.id}: ${text.match(/.{0,30}[çğıİöşüÇĞÖŞÜ].{0,30}/)?.[0]}`);
    });
  } finally {
    setLang("tr", null);
  }
});
