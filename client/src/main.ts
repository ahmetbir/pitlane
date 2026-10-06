// Pitlane client entry: the screens and the race loop are wired here.
const ui = document.getElementById("ui");
if (ui) ui.textContent = "Pitlane";

// DEBUG builds only: ?debug=track renders the circuit with cars on the racing line.
if (DEBUG && new URLSearchParams(location.search).get("debug") === "track") {
  const canvas = document.getElementById("game");
  if (canvas instanceof HTMLCanvasElement) void import("./debug/trackview.ts").then((m) => m.runTrackView(canvas, ui));
}
