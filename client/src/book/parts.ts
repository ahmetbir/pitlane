// The manual's generated parts, shared by both languages: the numbers it
// quotes (from the car model, the bindings, the room settings and the race
// rules) and its tables and drawings. The prose lives in tr.ts and en.ts.
import { ABS, defaultSetup, Handling, launchEnd, launchRPM, newParams, noDamage, revTop, setupMax, setupMin, TC, assistShares } from "../car/car.ts";
import { launchRevS, zeroTo100 } from "../car/measure.ts";
import { pct } from "../i18n/format.ts";
import { t } from "../i18n/index.ts";
import { firstKey, keyRows, keysLabel, padRows, type Action, type Bindings } from "../input/bindings.ts";
import { GAMEPAD_HOLD_S, STOPPED_VX, THROTTLE_RAMP_S } from "../input/input.ts";
import { kmh } from "../ui/fmt.ts";
import { LAP_CHOICES } from "../ui/create.ts";
import { SLIDERS, tcName, TC_LEVELS } from "../ui/garage.ts";
import { art, fixed, kbd, label, num, s, table } from "./kit.ts";
import { RULES } from "./rules.ts";

export { RULES };

/** Seconds, one decimal, in the current language. */
export const sec = (v: number, d = 1): string => fixed(v, d);

/** Numbers from the code (formatted where a unit needs it). */
export const F = {
  laps: LAP_CHOICES.join(", "),
  revKmh: String(kmh(revTop)),
  launchRPM: String(launchRPM),
  launchRevS: () => sec(launchRevS()),
  launchEndKmh: String(kmh(launchEnd)),
  stoppedVX: () => num(STOPPED_VX),
  throttleRampS: () => num(THROTTLE_RAMP_S, 2),
  padHoldS: String(GAMEPAD_HOLD_S),
  arcadeGrip: () => pct(newParams(Handling.Arcade, defaultSetup(), noDamage()).mu / newParams(Handling.Sim, defaultSetup(), noDamage()).mu - 1),
  arcadeTC: () => pct(newParams(Handling.Arcade, defaultSetup(), noDamage()).tcShare),
  simDefaultTC: () => tcName(defaultSetup()[TC]),
  jumpBanner: () => t("hud.jump", { n: RULES.jumpStartPenS }),
  jumpBadge: () => t("hud.pen", { n: RULES.jumpStartPenS }),
  simDefaultABS: () => tcName(defaultSetup()[ABS]),
  arcadeABS: () => pct(newParams(Handling.Arcade, defaultSetup(), noDamage()).absShare),
  wingLost: () => pct(RULES.wingLost),
  lostWingCL: () => pct(RULES.lostWingCL),
  suspLoss: () => pct(RULES.suspLoss),
  lapCapMin: String(RULES.lapCapS / 60),
  idleMin: String(RULES.idleLeaveS / 60),
};

/** A binding's keys as a key cap ("W / ↑"). */
export const keyOf = (b: Bindings, a: Action) => kbd(keysLabel(b[a]));

/** A live-adjust key pair as a key cap: "1 / 2". */
export const pairOf = (b: Bindings, lo: Action, hi: Action) => kbd(`${keysLabel(b[lo])} / ${keysLabel(b[hi])}`);

/** A chord as a key cap: "Shift + W". */
export const chord = (b: Bindings, a: Action, with_: Action) => kbd(`${firstKey(b, a) || "–"} + ${firstKey(b, with_) || "–"}`);

const twoCols = () => [t("bt.key"), t("bt.action")];

/** The keyboard table from the player's bindings. */
export const keyTable = (b: Bindings) => table(twoCols(), keyRows(b).map(([k, what]) => [kbd(k), what]));

/** The gamepad table. */
export const padTable = () => table(twoCols(), padRows().map(([k, what]) => [kbd(k), what]));

/** The garage settings: range and default, named as the garage names them. */
export function setupTable(): HTMLElement {
  const d = defaultSetup();
  const rows = SLIDERS.map((sl, i) => [t(sl.label), `${sl.value(setupMin[i])} … ${sl.value(setupMax[i])}`, sl.value(d[i])]);
  rows.push([t("garage.tc"), `${tcName(setupMin[TC])} … ${tcName(setupMax[TC])}`, tcName(d[TC])]);
  rows.push([t("garage.abs"), `${tcName(setupMin[ABS])} … ${tcName(setupMax[ABS])}`, tcName(d[ABS])]);
  return table([t("bt.setting"), t("bt.range"), t("bt.default")], rows);
}

/** A garage setting's name (the book's sub-headings match the garage). */
export const settingName = (i: number): string => (i === TC ? t("garage.tc") : i === ABS ? t("garage.abs") : t(SLIDERS[i].label));

/** TC levels: the share of the rear grip the throttle may use and the Sim 0–100 km/h. */
export function tcTable(): HTMLElement {
  return table([t("bt.level"), t("bt.share"), t("bt.z100")], TC_LEVELS.map((l) => [
    tcName(l), l === 0 ? t("bt.noLimit") : pct(assistShares[l]), `${sec(zeroTo100(Handling.Sim, l), 2)} ${t("bt.s")}`,
  ]));
}

/** ABS levels: the share of the grip cornering leaves that the brakes may use. */
export function absTable(): HTMLElement {
  return table([t("bt.level"), t("bt.shareAbs")], TC_LEVELS.map((l) => [tcName(l), l === 0 ? t("bt.noLimit") : pct(assistShares[l])]));
}

type Mode = { name: string; h: Handling; tc: number };

function modes(): Mode[] {
  const sim = (tc: number): Mode => ({ name: `Sim · TC ${tcName(tc)}`, h: Handling.Sim, tc });
  return [{ name: "Arcade", h: Handling.Arcade, tc: 3 }, sim(3), sim(2), sim(1), sim(0)];
}

/** 0–100 km/h from idle and after a launch, per handling and TC level. */
export function launchTable(): HTMLElement {
  return table([t("bt.mode"), t("bt.idle"), t("bt.launch"), t("bt.gain")], modes().map((m) => {
    const idle = zeroTo100(m.h, m.tc), go = zeroTo100(m.h, m.tc, true);
    const gain = idle - go;
    return [m.name, `${sec(idle, 2)} ${t("bt.s")}`, `${sec(go, 2)} ${t("bt.s")}`, gain >= 0.005 ? `−${sec(gain, 2)} ${t("bt.s")}` : "–"];
  }));
}

/** Bars: Sim 0–100 km/h per TC level, and Arcade; one hue, each bar labelled with its time. */
export function z100Art(): SVGSVGElement {
  const rows = [...TC_LEVELS.map((l) => ({ name: `TC ${tcName(l)}`, v: zeroTo100(Handling.Sim, l) })), { name: "Arcade", v: zeroTo100(Handling.Arcade, 3) }];
  const max = Math.ceil(Math.max(...rows.map((r) => r.v)));
  const x0 = 96, w = 300, top = 16, rh = 26;
  const x = (v: number) => x0 + (v / max) * w;
  const ticks = Array.from({ length: max + 1 }, (_, i) => i);
  return art(440, top + rows.length * rh + 34, t("art.z100"),
    ...ticks.map((v) => s("line", { x1: x(v), y1: top - 4, x2: x(v), y2: top + rows.length * rh, class: "grid" })),
    ...ticks.map((v) => label(x(v), top + rows.length * rh + 16, String(v), "mid small")),
    label(x0 + w / 2, top + rows.length * rh + 30, t("art.seconds"), "mid small"),
    ...rows.flatMap((r, i) => {
      const y = top + i * rh;
      return [
        label(x0 - 10, y + 16, r.name, "end"),
        s("rect", { x: x0, y: y + 4, width: Math.max(2, x(r.v) - x0), height: rh - 10, rx: 4, class: i === rows.length - 1 ? "bar alt" : "bar" },
          s("title", {}, `${r.name}: ${sec(r.v, 2)} ${t("bt.s")}`)),
        label(x(r.v) + 6, y + 16, `${sec(r.v, 2)} ${t("bt.s")}`, "small"),
      ];
    }));
}

/** The start lights: lamp i comes on at i × lightS seconds; then all go out together. */
export function lightsArt(): SVGSVGElement {
  const n = RULES.lightCount, cw = 60, x0 = 12;
  const goX = x0 + n * cw + 50;
  return art(goX + 70, 112, t("art.lights"),
    ...Array.from({ length: n }, (_, i) => {
      const cx = x0 + i * cw + cw / 2;
      return s("g", {},
        s("rect", { x: cx - 22, y: 10, width: 44, height: 66, rx: 7, class: "lamp-box" }),
        s("circle", { cx, cy: 28, r: 11, class: "lamp-on" }),
        s("circle", { cx, cy: 58, r: 11, class: "lamp-off" }),
        label(cx, 96, `${num(RULES.lightS * (i + 1))} ${t("bt.s")}`, "mid small"));
    }),
    s("path", { d: `M${x0 + n * cw + 6} 43 h30`, class: "arrow" }),
    s("path", { d: `M${x0 + n * cw + 30} 37 l8 6 l-8 6`, class: "arrow" }),
    label(goX + 22, 48, t("art.go"), "mid go"),
    label(goX + 22, 96, t("art.out"), "mid small"));
}

