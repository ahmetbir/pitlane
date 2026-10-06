// The race loop: one requestAnimationFrame callback. Input runs on a fixed
// 60 Hz accumulator (sample → send → predict, only while cars may move);
// then the frame: the drawn own car advances, the cameras follow the keys,
// the scene renders, the HUD's gauges update every frame and its texts at
// ~10 Hz.
import { DT, type Input } from "../car/car.ts";
import type { Controls } from "../input/input.ts";
import { carInput } from "../net/protocol.ts";

const MAX_FRAME_S = 0.25; // a longer frame (tab in background) is not caught up
const MAX_STEPS = 8;
const TEXT_S = 0.1;

export type LoopParts = {
  controls: Pick<Controls, "sample" | "cameraToggle" | "lookBack">;
  /** Sends one tick of input and predicts it. */
  input(i: Input): void;
  /** Whether inputs go out now (lights, racing, finish). */
  driving(): boolean;
  /** Draws one frame of dt seconds; cam: a C press, back: R held. */
  frame(dt: number, cam: boolean, back: boolean): void;
  /** The HUD's texts (~10 Hz). */
  text(): void;
};

/** The fixed-step part alone (tests): how many ticks a frame of dt runs, and the carried remainder. */
export function ticks(acc: number, dt: number): { n: number; acc: number } {
  let a = acc + Math.min(Math.max(dt, 0), MAX_FRAME_S);
  let n = 0;
  while (a >= DT && n < MAX_STEPS) {
    a -= DT;
    n++;
  }
  if (n === MAX_STEPS) a = Math.min(a, DT);
  return { n, acc: a };
}

/** Starts the loop; returns its stop. */
export function startLoop(p: LoopParts): () => void {
  let acc = 0, textAcc = TEXT_S, last = -1, raf = 0, stopped = false;
  const frame = (now: number) => {
    if (stopped) return;
    const dt = last < 0 ? 0 : Math.min((now - last) / 1000, MAX_FRAME_S);
    last = now;
    const k = ticks(acc, dt);
    acc = k.acc;
    for (let i = 0; i < k.n; i++) {
      const w = p.controls.sample(DT);
      if (p.driving()) p.input(carInput(w));
    }
    p.frame(dt, p.controls.cameraToggle(), p.controls.lookBack);
    textAcc += dt;
    if (textAcc >= TEXT_S) {
      textAcc = 0;
      p.text();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
