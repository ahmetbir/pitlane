// One race session: the socket, the 3D view, the race loop and the in-session
// screens (grid with the garage overlay, HUD, results, error), switched by
// flow.ts from the server's messages. leave() tears everything down.
import { RaceAudio } from "../audio/engine.ts";
import { speed, type Input } from "../car/car.ts";
import { RaceView } from "../game/view.ts";
import { startLoop } from "../game/loop.ts";
import { RaceState } from "../game/racestate.ts";
import { t } from "../i18n/index.ts";
import { errorText, noticeText } from "../i18n/messages.ts";
import { browserControls } from "../input/input.ts";
import type { Results, ServerMsg } from "../net/protocol.ts";
import { Session, socketURL } from "../net/session.ts";
import { kiyi } from "../track/track.ts";
import { fill, h } from "roomkit/ui/dom";
import { errorCard, loading, noWebGL, unreachableCard, type Banner } from "./banner.ts";
import { openView } from "./canvas.ts";
import { initialFlow, step, type FlowEvent } from "./flow.ts";
import { garagePanel } from "./garage.ts";
import { GridScreen } from "./grid.ts";
import type { Entry } from "./home.ts";
import { Hud } from "./hud.ts";
import { loadSettings, loadSetup, loadToken, storeToken } from "./prefs.ts";
import { resultsView } from "./results.ts";
import { focusFirst, Toast } from "./widgets.ts";

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
  const controls = browserControls();
  const leaveBtn = h("button", { type: "button", class: "btn small ghost hud-leave" }, t("grid.leave"));
  leaveBtn.addEventListener("click", () => leave());
  const hud = new Hud(track.segs, leaveBtn);
  const toast = new Toast(); // over the garage overlay
  const audio = new RaceAudio(settings.volume);
  let throttle = 0;
  const grid = new GridScreen({
    ready: () => session.ready(loadSetup()),
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
          fill(ui, h("div", { class: "screen overlay" }, h("section", { class: "panel" }, h("h2", {}, t("garage.title")), garagePanel(closeGarage))), toast.el);
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
      if (flow.view !== "grid") garageOpen = false;
      render(true);
    }
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
      session.input(i);
    },
    driving: () => race?.currentPhase() === "lights" || race?.currentPhase() === "racing" || race?.currentPhase() === "finish",
    frame: (dt: number, cam: boolean, back: boolean) => {
      if (!view) return;
      if (cam) view.toggleCamera();
      view.lookBack(back);
      session.frame(dt);
      const st = session.ownCar();
      const others = session.otherCars();
      view.draw(dt, st ? { id: car, st, wingLost: race?.ownLatest()?.wingLost ?? false } : null, others);
      audio.setActive(flow.view === "race");
      if (flow.view !== "race") return;
      if (st) audio.frame(dt, st, throttle, others);
      if (st) hud.gauges(speed(st), st.gear, st.rpm);
      hud.drawMap(st ? [...others, { id: car, x: st.x, z: st.z }] : others, car);
    },
    text: () => {
      if (flow.view === "race" && race) hud.text(race.hud(session.ownCar()));
    },
  });

  function teardown(): void {
    if (closed) return;
    closed = true;
    stopLoop?.();
    session.close();
    controls.dispose();
    hud.dispose();
    grid.dispose();
    toast.clear();
    window.removeEventListener("keydown", onKey);
    audio.dispose();
    view?.dispose();
    view = null;
    banner.hide();
  }

  function leave(): void {
    teardown();
    history.pushState(null, "", "/");
    o.home();
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
