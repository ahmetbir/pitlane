// DEBUG-only render check (?debug=track): the circuit with ten cars on the
// racing line, a light sequence, both cameras. Keys: C camera, hold R look
// back, 1–9/0 follow a car. Not part of the production bundle. Returns the
// teardown: listeners off, loop cancelled, GPU resources released.
import { DT, Handling, newParams, speed, type Params, type State } from "../car/car.ts";
import { moveCar, type Hint } from "../race/world.ts";
import { Cams } from "../render/cams.ts";
import { buildCar, type CarMesh } from "../render/carmesh.ts";
import { toWorld } from "../render/frame.ts";
import { teamColour } from "../render/palette.ts";
import { Stage } from "../render/scene.ts";
import { buildTrack } from "../render/trackmesh.ts";
import { kiyi } from "../track/track.ts";
import { AutoDriver } from "./autodrive.ts";

const GO_AT = 6; // s: lights out

type Runner = { st: State; p: Params; hint: Hint; drv: AutoDriver; mesh: CarMesh; rolled: number };

export function runTrackView(canvas: HTMLCanvasElement, ui: HTMLElement | null): () => void {
  const stage = new Stage(canvas);
  const track = kiyi();
  const circuit = buildTrack(track);
  stage.add(circuit.root);

  const runners: Runner[] = track.grid.map((g, i) => {
    const st: State = { x: g.x, z: g.z, h: g.h, hx: Math.cos(g.h), hz: Math.sin(g.h), vx: 0, vy: 0, r: 0, delta: 0, rpm: 4000, gear: 1, ax: 0, dmg: { frontWing: 0, rearWing: 0, susp: 0 } };
    const mesh = buildCar(teamColour(i));
    stage.add(mesh.root);
    // The pole sitter is the quickest, so the field spreads out instead of driving through itself.
    return { st, p: newParams(Handling.Arcade, [6, 6, 58, 3, 5, 5], st.dmg), hint: { i: -1 }, drv: new AutoDriver(track, 18.25 - 0.25 * i), mesh, rolled: 0 };
  });

  const cams = new Cams(stage.camera);
  let follow = 0, clock = 0, acc = 0;
  const down = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === "KeyC") cams.toggle();
    else if (e.code === "KeyR") cams.lookBack(true);
    else if (/^Digit\d$/.test(e.code)) {
      follow = (Number(e.code.slice(5)) + 9) % 10;
      cams.snap();
    }
  };
  const up = (e: KeyboardEvent) => {
    if (e.code === "KeyR") cams.lookBack(false);
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);

  const stop = stage.animate((dt) => {
    clock += dt;
    circuit.setLights(Math.floor(clock), clock >= GO_AT);
    if (clock >= GO_AT) {
      for (acc += dt; acc >= DT; acc -= DT) {
        for (const r of runners) {
          const s = track.locate(r.st.x, r.st.z, r.hint.i).s;
          moveCar(r.st, r.p, r.drv.input(r.st, s), track, r.hint);
          r.rolled += r.st.vx * DT;
        }
      }
    }
    for (const r of runners) r.mesh.update(r.st, r.rolled, false);
    const f = runners[follow].st;
    cams.update(dt, { x: f.x, z: f.z, h: f.h, delta: f.delta, speed: speed(f) });
    stage.focus(toWorld(f.x, f.z));
  });

  let last = performance.now(), frames = 0, shown = last, raf = 0;
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    stage.update(dt);
    frames++;
    if (ui && now - shown > 500) {
      const { calls, triangles } = stage.info();
      const v = speed(runners[follow].st) * 3.6;
      ui.textContent = `debug=track · car ${follow + 1} · ${v.toFixed(0)} km/h · ${cams.mode()} · ${calls} calls · ${triangles} tris · ${((frames * 1000) / (now - shown)).toFixed(0)} fps`;
      frames = 0;
      shown = now;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  let done = false;
  return () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    stop();
    for (const r of runners) r.mesh.dispose();
    circuit.dispose();
    stage.dispose();
  };
}
