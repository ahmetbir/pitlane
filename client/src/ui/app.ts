// One race session: the socket, the 3D view, the race loop and the in-session
// screens (grid with the garage overlay, HUD, results, error), switched by
// flow.ts from the server's messages, plus the controls card (shown once
// before the first race, then on the help key) and the driver's manual. The
// session holds one current setup: the garage's, which the live controls
// (brake bias, diff, TC, ABS) change while racing; it is stored at once and
// goes out with every input.
// leave() tears everything down.
import { RaceAudio } from "../audio/engine.ts";
import { Book } from "../book/book.ts";
import { liveOf, speed, type Input } from "../car/car.ts";
import { RaceView } from "../game/view.ts";
import { startLoop } from "../game/loop.ts";
import { RaceState } from "../game/racestate.ts";
import { t } from "../i18n/index.ts";
import { errorText, noticeText } from "../i18n/messages.ts";
import { firstKey, LIVE_ACTIONS, type Action } from "../input/bindings.ts";
import { liveStep } from "../game/live.ts";
import { browserControls, STOPPED_VX } from "../input/input.ts";
import type { HandlingName, Results, ServerMsg } from "../net/protocol.ts";
import { Session, socketURL } from "../net/session.ts";
import { kiyi } from "../track/track.ts";
import { fill, h } from "roomkit/ui/dom";
import { errorCard, loading, noWebGL, unreachableCard, type Banner } from "./banner.ts";
import { openView } from "./canvas.ts";
import { ControlsCard } from "./controlscard.ts";
import { initialFlow, step, type FlowEvent } from "./flow.ts";
import { garagePanel } from "./garage.ts";
import { GridScreen } from "./grid.ts";
import type { Entry } from "./home.ts";
import { Hud } from "./hud.ts";
import { loadSettings, loadSetup, loadToken, saveSettings, saveSetup, storeToken } from "./prefs.ts";
import { resultsView } from "./results.ts";
import { focusFirst, Toast } from "./widgets.ts";

/** A race with no key or pad activity for this long is left (an idle tab costs bandwidth). */
export const IDLE_LEAVE_S = 5 * 60;
const IDLE_CHECK_MS = 5000; // a timer, not the frame loop: a hidden tab draws no frames

export type PlayOpts = {
  /** A fresh canvas for this race's renderer (main swaps the page's #game element). */
  canvas: () => HTMLCanvasElement;
  ui: HTMLElement; banner: Banner; name: string; entry: Entry;
  /** Back to the home page (after the session is torn down). */
  home(): void;
};

export function play(o: PlayOpts): void {
  const { ui, banner } = o;
  const track = kiyi();
  const settings = loadSettings();
  const keys = settings.keys;
  const book = new Book(() => ({ keys }));
  // While the manual or a controls card the player opened is up the car gets neutral input and
  // coasts; the automatic first-race card never blocks (it closes itself at the lights).
  const controls = browserControls(keys, () => session.ownCar()?.vx ?? 0, () => session.ownCar()?.gear ?? 1,
    () => book.isOpen() || (card.isOpen() && !autoCard));
  let autoCard = false; // the card on screen is the automatic first-race one
  const card = new ControlsCard({
    closed: () => {
      autoCard = false;
      if (settings.seenControls) return;
      settings.seenControls = true;
      saveSettings({ ...loadSettings(), seenControls: true });
    },
    manual: () => book.open(),
  });
  document.body.append(card.el);
  const leaveBtn = h("button", { type: "button", class: "btn small ghost hud-leave" }, t("grid.leave"));
  leaveBtn.addEventListener("click", () => leave());
  const tool = (label: string, title: string, go: () => void) => {
    const b = h("button", { type: "button", class: "btn small ghost hud-tool", title, "aria-label": title }, label);
    b.addEventListener("click", () => {
      b.blur(); // keys go back to the car
      go();
    });
    return b;
  };
  /** The player opens or closes the card (help key, ? button): it blocks driving while up. */
  const toggleCard = () => {
    autoCard = false;
    card.toggle(keys);
  };
  const helpBtn = tool("?", t("hud.help"), toggleCard);
  const manualBtn = tool(t("hud.manual"), t("hud.manual"), () => book.open());
  const chord = (a: Action) => `${firstKey(keys, a)}+${firstKey(keys, "throttle")}`;
  const hud = new Hud(track.segs, [leaveBtn, helpBtn, manualBtn], t("hud.launchHint", { chord1: chord("brake"), chord2: chord("launch") }));
  let setup = loadSetup(); // the current setup: the garage's, changed by the live controls
  const toast = new Toast(); // over the garage overlay
  const audio = new RaceAudio(settings.volume);
  let throttle = 0;
  const grid = new GridScreen({
    ready: () => session.ready((setup = loadSetup())),
    start: () => session.start(),
    garage: () => {
      garageOpen = true;
      render(true);
    },
    leave: () => leave(),
  });

  let flow = initialFlow();
  let garageOpen = false;
  let car = 0;
  let laps = 3;
  let handling: HandlingName = "arcade";
  let results: Results | null = null;
  let view: RaceView | null = null;
  let race: RaceState | null = null;
  let stopLoop: (() => void) | null = null;
  let closed = false;

  const render = (force = false) => {
    switch (flow.view) {
      case "connecting":
        fill(ui, loading());
        break;
      case "grid":
        if (garageOpen) {
          fill(ui, h("div", { class: "screen overlay" }, h("section", { class: "panel" }, h("h2", {}, t("garage.title")), garagePanel(closeGarage, handling))), toast.el);
          focusFirst(ui);
        } else if (force || !ui.contains(grid.el)) fill(ui, grid.el);
        break;
      case "race":
        if (force || !ui.contains(hud.el)) fill(ui, hud.el);
        break;
      case "results":
        fill(ui, resultsView(results?.rows ?? [], car, leaveBtn));
        break;
      case "error":
        errorCard(ui, t("card.joinFail"), errorText(flow.error?.code, flow.error?.msg ?? ""));
        break;
    }
  };

  function closeGarage(): void {
    garageOpen = false;
    setup = loadSetup();
    render(true);
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && garageOpen && flow.view === "grid") closeGarage();
  };
  window.addEventListener("keydown", onKey);

  const advance = (e: FlowEvent) => {
    const before = flow.view;
    flow = step(flow, e);
    if (flow.view !== before || e.t === "retry") {
      if (flow.view === "race" && before !== "race") controls.touch(); // idle counts from the start
      if (flow.view !== "grid") garageOpen = false;
      render(true);
      if ((flow.view === "grid" || flow.view === "race") && flow.phase !== "lights" && !settings.seenControls && !card.isOpen()) {
        autoCard = true;
        card.open(keys);
      }
    }
    if (autoCard && card.isOpen() && flow.phase === "lights") card.close(); // the start: the first-race card goes
  };

  const onMsg = (m: ServerMsg) => {
    race?.apply(m);
    switch (m.t) {
      case "welcome":
        if (m.tok) {
          storeToken(m.tok);
          session.setToken(m.tok);
        }
        if (location.pathname !== `/r/${m.code}`) history.replaceState(null, "", `/r/${m.code}`);
        car = m.car;
        laps = m.laps;
        handling = m.handling;
        if (!view) {
          view = openView(o.canvas, (c) => new RaceView(c, track, m.contact, settings.camera));
          if (!view) {
            teardown();
            noWebGL(ui);
            return;
          }
          race = new RaceState(track, laps, () => car);
          race.apply(m);
          stopLoop = startLoop(loopParts());
        }
        view.snapCamera();
        break;
      case "grid":
        grid.show(m, car, session.code());
        break;
      case "snap":
        if (m.phase === "grid" && flow.phase !== "grid") {
          view?.setLights(0, false);
          hud.hideLights();
        }
        break;
      case "lights":
        view?.setLights(m.on, m.on === 0);
        hud.lights(m.on, m.on === 0);
        break;
      case "results":
        results = m;
        break;
      case "reset":
        if (m.car === car) {
          hud.toast(t("hud.reset"));
          view?.snapCamera();
        }
        break;
      case "pen":
        if (m.why !== "jump") break;
        if (m.car === car) {
          hud.penalty(m.ms);
          audio.penalty();
        } else hud.toast(t("hud.jumpOther", { name: race?.nameOf(m.car) ?? `#${m.car}` }));
        break;
      case "wing":
        if (m.car === car) hud.toast(t("hud.wing"));
        break;
      case "dmg":
        if (m.car === car) audio.contact();
        break;
      case "notice":
        if (flow.view === "grid" && garageOpen) toast.show(noticeText(m.code, m.msg));
        else if (flow.view === "grid") grid.notice(noticeText(m.code, m.msg));
        else hud.toast(noticeText(m.code, m.msg));
        break;
    }
    advance({ t: "msg", m });
    if (m.t === "results" && flow.view === "results") render(true);
  };

  const loopParts = () => ({
    controls,
    input: (i: Input) => {
      throttle = i.throttle;
      session.input(i, liveOf(setup));
    },
    driving: () => race?.currentPhase() === "lights" || race?.currentPhase() === "racing" || race?.currentPhase() === "finish",
    frame: (dt: number, cam: boolean, back: boolean) => {
      if (!view) return;
      if (cam) view.toggleCamera();
      if (controls.take("help") && (flow.view === "grid" || flow.view === "race")) toggleCard();
      view.lookBack(back);
      const arcade = handling === "arcade";
      let changed = -1; // the setup index a live control just moved
      for (const a of LIVE_ACTIONS) {
        if (!controls.take(a) || flow.view !== "race") continue; // presses off the race go nowhere
        const r = liveStep(setup, a, arcade);
        if (r.changed < 0) continue;
        setup = saveSetup(r.setup);
        changed = r.changed;
      }
      session.frame(dt);
      const st = session.ownCar();
      const others = session.otherCars();
      view.draw(dt, st ? { id: car, st, wingLost: race?.ownLatest()?.wingLost ?? false } : null, others);
      audio.setActive(flow.view === "race");
      if (flow.view !== "race") return;
      if (st) audio.frame(dt, st, throttle, others);
      if (st) hud.gauges(speed(st), st.gear, st.rpm, st.launch && Math.abs(st.vx) < STOPPED_VX);
      hud.setLive(setup, arcade, changed);
      hud.drawMap(st ? [...others, { id: car, x: st.x, z: st.z }] : others, car);
    },
    text: () => {
      if (flow.view === "race" && race) hud.text(race.hud(session.ownCar()));
    },
  });

  const idleTimer = setInterval(() => {
    if (flow.view === "race" && controls.idleS() >= IDLE_LEAVE_S) leave(t("race.idle"));
  }, IDLE_CHECK_MS);

  function teardown(): void {
    if (closed) return;
    closed = true;
    clearInterval(idleTimer);
    stopLoop?.();
    session.close();
    controls.dispose();
    card.hide();
    card.el.remove();
    book.close();
    hud.dispose();
    grid.dispose();
    toast.clear();
    window.removeEventListener("keydown", onKey);
    audio.dispose();
    view?.dispose();
    view = null;
    banner.hide();
  }

  /** Back home; note is shown there as a toast. */
  function leave(note?: string): void {
    teardown();
    history.pushState(null, "", "/");
    o.home();
    if (note) {
      const home = new Toast();
      ui.append(home.el);
      home.show(note, 6000);
    }
  }

  const session: Session = new Session(socketURL(location), o.name, o.entry, track, {
    onMsg,
    onStatus: (s) => banner.status(s),
    onFatal: (code, msg) => {
      teardown();
      advance({ t: "fatal", code, msg });
    },
    onUnreachable: () => unreachableCard(ui, () => {
      advance({ t: "retry" });
      session.retry();
    }),
  });
  session.setToken(loadToken()); // before the first open writes the hello
  render(true);
}
