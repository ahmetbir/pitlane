// The race HUD: position, lap, lap times with the live delta, gaps to the
// cars ahead and behind, sector colours, speed, gear (R in reverse), the rpm
// bar, the live setup (brake bias, TC, ABS, diff; the value just changed
// lights up for HOT_MS), the launch indicator, the start lights
// with the launch hint, hints (wrong way, off track), toasts and the mini-map.
// Texts update at ~10 Hz (text()); the gauges and the map every frame.
import { h, text } from "roomkit/ui/dom";
import { ABS, BrakeBias, Diff, launchRPM, TC, type Setup } from "../car/car.ts";
import { fixed } from "../i18n/format.ts";
import { t } from "../i18n/index.ts";
import type { Gap, SectorColour } from "../timing/standings.ts";
import { fmtDelta, fmtGap, fmtLap, fmtTime, kmh } from "./fmt.ts";
import { MiniMap, type Dot, type XZ } from "./minimap.ts";
import { Toast } from "./widgets.ts";

const RPM_IDLE = 4000;
const RPM_LIMIT = 13500;
const RPM_SHIFT = 12800; // the gearbox's upshift point
const GO_MS = 1200;
const LAUNCH_READY = launchRPM - 100; // the bar turns green: the hold is at its rpm
const PEN_BANNER_MS = 4000; // the jump-start banner stays up this long
const HOT_MS = 1500; // a live value just changed stays lit this long

/** The live readout's setup indices, in display order. */
export const LIVE_ORDER: readonly number[] = [BrakeBias, TC, ABS, Diff];

export type GapView = { name: string; gap: Gap };

export type HudText = {
  pos: number; cars: number; lap: number; laps: number;
  current: number | null; last: number; best: number; delta: number | null;
  ahead: GapView | null; behind: GapView | null;
  sectors: readonly SectorColour[];
  finished: boolean; wrongWay: boolean; offTrack: boolean;
  /** The own car's penalty this race, ms (0 = none). */
  penMs: number;
};

/** The lap being driven: laps completed + 1, never past the race distance. */
export function lapOf(done: number, laps: number): number {
  return Math.max(1, Math.min(done + 1, laps));
}

/** A gap's text: "1.2" seconds, or "+1 lap" when lapped. */
export function gapText(g: Gap): string {
  return g.laps > 0 ? t("hud.lapsDown", { n: g.laps }) : fmtGap(g.ms);
}

/** The gear's label: "R" for reverse (gear 0). */
export function gearLabel(gear: number): string {
  return gear === 0 ? "R" : String(gear);
}

/** Whether a launch hold's engine is at the launch rpm (the bar turns green). */
export function launchReady(rpm: number): boolean {
  return rpm >= LAUNCH_READY;
}

/** The penalty badge: "+5 s" (whole seconds, as the results table). */
export function penBadge(ms: number): string {
  return ms > 0 ? t("hud.pen", { n: Math.round(ms / 1000) }) : "";
}

/**
 * The live readout in LIVE_ORDER: "BB 58.0", "TC 1", "ABS 1", "DIFF 5"; level
 * 0 is off ("TC 0", drawn as off); in Arcade TC and ABS are the room's, shown
 * as "TC A", "ABS A". Short enough for one line at phone width.
 */
export function liveParts(s: Readonly<Setup>, arcade: boolean): string[] {
  const a = t("hud.arcadeAssist");
  return [
    `${t("hud.bb")} ${fixed(s[BrakeBias], 1)}`,
    `TC ${arcade ? a : s[TC]}`,
    `ABS ${arcade ? a : s[ABS]}`,
    `${t("hud.diff")} ${s[Diff]}`,
  ];
}

/** A live control press: the setup index it acts on, and whether the value moved (not at a limit or locked). */
export type LivePress = { index: number; moved: boolean };

/** Rpm as the bar's fill 0..1. */
export function rpmFill(rpm: number): number {
  if (!Number.isFinite(rpm)) return 0;
  return Math.max(0, Math.min(1, (rpm - RPM_IDLE) / (RPM_LIMIT - RPM_IDLE)));
}

function cell(label: string, value: HTMLElement): HTMLElement {
  return h("div", { class: "cell" }, h("span", { class: "k" }, label), value);
}

export class Hud {
  readonly el: HTMLElement;
  private readonly map: MiniMap;
  private readonly pos = h("span", { class: "v big" });
  private readonly lap = h("span", { class: "v big" });
  private readonly cur = h("span", { class: "v mono" });
  private readonly last = h("span", { class: "v mono" });
  private readonly best = h("span", { class: "v mono" });
  private readonly delta = h("span", { class: "delta mono" });
  private readonly sectors = [0, 1, 2].map(() => h("i", { class: "sector" }));
  private readonly ahead = h("div", { class: "gap ahead" });
  private readonly behind = h("div", { class: "gap behind" });
  private readonly speed = h("span", { class: "speed mono" });
  private readonly gear = h("span", { class: "gear mono" });
  private readonly rpm = h("i", { class: "rpm-fill" });
  private readonly rpmBar = h("div", { class: "rpm" }, this.rpm);
  private readonly live = LIVE_ORDER.map(() => h("span", { class: "live-v" }));
  private readonly liveEl = h("div", { class: "live" }, ...this.live.flatMap((el, i) => (i ? [h("i", { class: "live-sep", "aria-hidden": "true" }, "·"), el] : [el])));
  private liveShown = "";
  private hot = -1; // the LIVE_ORDER slot lit, −1 none
  private hotTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly launch = h("span", { class: "launch-badge", hidden: true }, t("hud.launch"));
  private readonly penEl = h("span", { class: "pen-badge", hidden: true });
  private readonly penBanner = h("div", { class: "pen-banner", role: "alert" });
  private penTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly launchHint = h("p", { class: "launch-hint" });
  private readonly hint = h("div", { class: "hint-banner", role: "status" });
  private readonly toasts = new Toast();
  private readonly lamps = [0, 1, 2, 3, 4].map(() => h("i", { class: "lamp" }));
  private readonly lightsEl: HTMLElement;
  private readonly go = h("div", { class: "go" });
  private goTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSpeed = -1;
  private lastGear = -1;
  private bar = ""; // the rpm bar's state class: "", "shift", "launch", "ready"

  /** tools: the buttons of the top-left panel (Leave, controls, manual); launchHint: the lights' hint text. */
  constructor(outline: readonly XZ[], tools: readonly HTMLElement[], launchHint: string) {
    this.map = new MiniMap(outline);
    text(this.launchHint, launchHint);
    this.lightsEl = h("div", { class: "lights", hidden: true }, h("div", { class: "lamps" }, ...this.lamps), this.go, this.launchHint);
    this.el = h("div", { class: "hud", "aria-live": "off" },
      h("div", { class: "hud-tl" }, cell(t("hud.pos"), this.pos), cell(t("hud.lap"), this.lap), h("div", { class: "hud-tools" }, ...tools)),
      h("div", { class: "hud-tr" },
        h("div", { class: "times" }, cell(t("hud.time"), this.cur), this.delta, cell(t("hud.last"), this.last), cell(t("hud.best"), this.best)),
        h("div", { class: "sectors" }, ...this.sectors),
        this.ahead, this.behind),
      h("div", { class: "hud-bl" }, this.map.el),
      h("div", { class: "hud-bc" },
        h("div", { class: "dash" }, this.speed, h("span", { class: "unit" }, t("hud.kmh")), h("span", { class: "gear-box" }, h("span", { class: "k" }, t("hud.gear")), this.gear)),
        this.rpmBar,
        this.liveEl,
        h("div", { class: "dash-tags" }, this.launch, this.penEl)),
      this.penBanner, this.hint, this.toasts.el, this.lightsEl);
  }

  /** The text parts (~10 Hz). */
  text(v: HudText): void {
    text(this.pos, v.pos > 0 ? `${v.pos}/${v.cars}` : "–");
    text(this.lap, `${v.lap}/${v.laps}`);
    text(this.cur, v.current === null ? fmtLap(0) : fmtTime(v.current));
    text(this.last, fmtLap(v.last));
    text(this.best, fmtLap(v.best));
    text(this.delta, v.delta === null ? "" : fmtDelta(v.delta));
    this.delta.className = `delta mono ${v.delta === null ? "" : v.delta <= 0 ? "faster" : "slower"}`;
    this.sectors.forEach((s, i) => {
      s.className = `sector ${v.sectors[i] ?? ""}`;
    });
    this.gapLine(this.ahead, t("hud.ahead"), v.ahead);
    this.gapLine(this.behind, t("hud.behind"), v.behind);
    const pen = penBadge(v.penMs);
    text(this.penEl, pen);
    this.penEl.hidden = pen === "";
    const hint = v.finished ? t("hud.finished") : v.wrongWay ? t("hud.wrongWay") : v.offTrack ? t("hud.offTrack") : "";
    text(this.hint, hint);
    this.hint.className = `hint-banner ${hint ? "on" : ""} ${v.wrongWay && !v.finished ? "warn" : ""}`;
  }

  /**
   * The live setup the car drives with (every frame; the DOM is touched only
   * on change); press: a live control pressed this frame. Its value lights up
   * for HOT_MS: bright when it moved, muted when it could not (a range limit,
   * or TC/ABS in Arcade).
   */
  setLive(s: Readonly<Setup>, arcade: boolean, press: LivePress | null = null): void {
    const parts = liveParts(s, arcade);
    const key = parts.join("|");
    if (key !== this.liveShown) {
      this.liveShown = key;
      parts.forEach((p, i) => text(this.live[i], p));
      this.live[1].classList.toggle("off", !arcade && s[TC] === 0);
      this.live[2].classList.toggle("off", !arcade && s[ABS] === 0);
      const level = (v: number) => (arcade ? t("hud.arcadeAssistTitle") : v === 0 ? t("garage.tcOff") : String(v));
      const titles = [t("garage.bb"), `${t("garage.tc")}: ${level(s[TC])}`, `${t("garage.abs")}: ${level(s[ABS])}`, t("garage.diff")];
      this.live.forEach((el, i) => el.setAttribute("title", titles[i]));
    }
    if (!press) return;
    const slot = LIVE_ORDER.indexOf(press.index);
    if (slot < 0) return;
    if (this.hot >= 0) this.live[this.hot].classList.remove("hot", "edge");
    this.hot = slot;
    this.live[slot].classList.add(press.moved ? "hot" : "edge");
    if (this.hotTimer !== null) clearTimeout(this.hotTimer);
    this.hotTimer = setTimeout(() => {
      this.live[slot].classList.remove("hot", "edge");
      this.hot = -1;
      this.hotTimer = null;
    }, HOT_MS);
  }

  /**
   * Speed (m/s), gear and rpm; holding: a launch hold is on (every frame; the
   * DOM is touched only on change).
   */
  gauges(speedMs: number, gear: number, rpm: number, holding = false): void {
    const v = kmh(speedMs);
    if (v !== this.lastSpeed) {
      this.lastSpeed = v;
      text(this.speed, String(v));
    }
    if (gear !== this.lastGear) {
      this.lastGear = gear;
      text(this.gear, gearLabel(gear));
      this.gear.classList.toggle("rev", gear === 0);
    }
    this.rpm.style.transform = `scaleX(${rpmFill(rpm).toFixed(3)})`;
    const bar = holding ? (launchReady(rpm) ? "ready" : "launch") : rpm >= RPM_SHIFT ? "shift" : "";
    if (bar !== this.bar) {
      this.bar = bar;
      this.rpm.className = `rpm-fill ${bar}`.trim();
      this.launch.hidden = !holding;
      this.launch.classList.toggle("ready", bar === "ready");
    }
  }

  /** Cars on the mini-map (every frame). */
  drawMap(dots: readonly Dot[], own: number): void {
    this.map.draw(dots, own);
  }

  /** Start lights: on lamps lit (1..5); out: all dark with GO, then the overlay hides. */
  lights(on: number, out: boolean): void {
    if (this.goTimer !== null) clearTimeout(this.goTimer);
    this.goTimer = null;
    this.lightsEl.hidden = false;
    this.lamps.forEach((l, i) => l.classList.toggle("on", !out && i < on));
    text(this.go, out ? t("hud.go") : "");
    this.launchHint.hidden = out;
    if (out) this.goTimer = setTimeout(() => this.hideLights(), GO_MS);
  }

  hideLights(): void {
    this.lightsEl.hidden = true;
  }

  /** The own jump-start banner: up for PEN_BANNER_MS ("JUMP START · +5 s penalty"). */
  penalty(ms: number): void {
    text(this.penBanner, t("hud.jump", { n: Math.round(ms / 1000) }));
    this.penBanner.classList.add("on");
    if (this.penTimer !== null) clearTimeout(this.penTimer);
    this.penTimer = setTimeout(() => {
      this.penBanner.classList.remove("on");
      this.penTimer = null;
    }, PEN_BANNER_MS);
  }

  /** A short message in the middle of the screen. */
  toast(msg: string): void {
    this.toasts.show(msg);
  }

  dispose(): void {
    this.toasts.clear();
    if (this.goTimer !== null) clearTimeout(this.goTimer);
    if (this.hotTimer !== null) clearTimeout(this.hotTimer);
    if (this.penTimer !== null) clearTimeout(this.penTimer);
  }

  private gapLine(el: HTMLElement, label: string, g: GapView | null): void {
    text(el, g ? `${label} · ${g.name}  ${gapText(g.gap)}` : "");
  }
}
