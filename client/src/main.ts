// Pitlane client entry: language, routing (/ → home, /r/CODE → join) and the
// pages that lead into a race session (ui/app.ts runs the session and its loop).
import { normalizeCode } from "roomkit/net/code";
import { initialLang, setLang } from "./i18n/index.ts";
import { play } from "./ui/app.ts";
import { Banner, noWebGL } from "./ui/banner.ts";
import { hasWebGL, swapCanvas } from "./ui/canvas.ts";
import { garagePanel } from "./ui/garage.ts";
import { showHome, showJoin, type Entry } from "./ui/home.ts";
import { showLeaderboard } from "./ui/leaderboard.ts";
import { showSettings } from "./ui/settings.ts";
import { focusFirst, page } from "./ui/widgets.ts";
import { t } from "./i18n/index.ts";
import { fill } from "roomkit/ui/dom";

const ui = document.getElementById("ui");
const canvas = document.getElementById("game");
const bannerEl = document.getElementById("banner");

// The stored language, else the browser's (tr* → Turkish, anything else English).
setLang(initialLang(navigator.languages?.length ? navigator.languages : [navigator.language]));

function route(first: HTMLCanvasElement, ui: HTMLElement, banner: Banner): void {
  // Every race draws on a fresh #game canvas: the last race's context was forced lost.
  let canvas = first;
  const freshCanvas = (): HTMLCanvasElement => (canvas = swapCanvas(canvas, () => document.createElement("canvas")));
  const home = (): void => showHome(ui, nav);
  const nav = {
    play: (name: string, entry: Entry) => {
      if (!hasWebGL()) return noWebGL(ui);
      play({ canvas: freshCanvas, ui, banner, name, entry, home });
    },
    garage: () => {
      fill(ui, page("garage-page", t("garage.title"), home, garagePanel(home)));
      focusFirst(ui);
    },
    board: () => showLeaderboard(ui, home),
    settings: () => showSettings(ui, home),
  };
  const m = /^\/r\/([^/]{1,16})\/?$/.exec(location.pathname);
  const code = m ? normalizeCode(m[1]) : "";
  if (code) return showJoin(ui, code, nav.play);
  if (location.pathname !== "/") history.replaceState(null, "", "/");
  home();
}

// DEBUG builds only: ?debug=track renders the circuit with cars on the racing line.
const debugTrack = DEBUG && new URLSearchParams(location.search).get("debug") === "track";
if (debugTrack && canvas instanceof HTMLCanvasElement) {
  void import("./debug/trackview.ts").then((d) => d.runTrackView(canvas, ui));
} else if (ui && bannerEl && canvas instanceof HTMLCanvasElement) {
  route(canvas, ui, new Banner(bannerEl));
}
