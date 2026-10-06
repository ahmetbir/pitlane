// Which in-session screen shows, decided from server messages alone (pure, so
// tests drive it with fake messages). The 3D scene stays behind every view;
// the garage is an overlay of the grid and is not a view of its own.
import type { Phase, ServerMsg } from "../net/protocol.ts";

export type View = "connecting" | "grid" | "race" | "results" | "error";

export type Flow = {
  view: View;
  phase: Phase | null; // of the latest snapshot since the welcome
  error: { code: string; msg: string } | null;
};

export type FlowEvent = { t: "msg"; m: ServerMsg } | { t: "fatal"; code: string; msg: string } | { t: "retry" };

export const initialFlow = (): Flow => ({ view: "connecting", phase: null, error: null });

const running = (p: Phase): boolean => p === "lights" || p === "racing" || p === "finish";

/** The view a phase shows; results stay up until the grid forms again. */
function viewOf(p: Phase, cur: View): View {
  if (p === "grid") return "grid";
  if (running(p)) return "race";
  return cur === "results" ? "results" : "race"; // results phase without the table (yet): keep the race behind
}

export function step(f: Flow, e: FlowEvent): Flow {
  if (e.t === "fatal") return { ...f, view: "error", error: { code: e.code, msg: e.msg } };
  if (e.t === "retry") return initialFlow();
  if (f.view === "error") return f;
  const m = e.m;
  switch (m.t) {
    case "welcome":
      // A new seat (first join or a reconnect): the phase is learnt again from the next snapshot.
      return { ...f, view: "grid", phase: null };
    case "snap": {
      const view = viewOf(m.phase, f.view);
      return view === f.view && m.phase === f.phase ? f : { ...f, view, phase: m.phase };
    }
    // "grid" (the roster) also arrives mid-race and during results (a join): it changes no view;
    // the snapshot of the grid phase, one tick behind it, does.
    case "lights":
      return { ...f, view: "race", phase: "lights" };
    case "results":
      return { ...f, view: "results", phase: "results" };
    default:
      return f;
  }
}
