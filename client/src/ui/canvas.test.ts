import { test } from "node:test";
import assert from "node:assert/strict";
import { openView, swapCanvas } from "./canvas.ts";

/** A fake page holding one canvas slot; a canvas whose context was lost cannot build a view. */
class FakeCanvas {
  id = "";
  lost = false;
  private readonly page: { slot: FakeCanvas | null };
  constructor(page: { slot: FakeCanvas | null }) {
    this.page = page;
  }
  replaceWith(next: FakeCanvas): void {
    assert.equal(this.page.slot, this, "only the canvas in the page is replaced");
    this.page.slot = next;
  }
}

class FakeView {
  readonly c: FakeCanvas;
  constructor(c: FakeCanvas) {
    if (c.lost) throw new Error("context lost");
    this.c = c;
  }
  dispose(): void {
    this.c.lost = true; // Stage.dispose → forceContextLoss
  }
}

test("race → leave → race: every race gets a fresh canvas, the old one leaves the page", () => {
  const page: { slot: FakeCanvas | null } = { slot: null };
  const first = new FakeCanvas(page);
  first.id = "game";
  page.slot = first;
  const canvas = () => swapCanvas(page.slot!, () => new FakeCanvas(page));

  const v1 = openView(canvas, (c) => new FakeView(c));
  assert.ok(v1);
  v1.dispose();
  const v2 = openView(canvas, (c) => new FakeView(c));
  assert.ok(v2, "the second race builds on a fresh canvas");
  assert.notEqual(v2.c, v1.c);
  assert.equal(page.slot, v2.c);
  assert.equal(v2.c.id, "game");
});

test("reusing the lost canvas fails, and the failure is a null view, not a throw", () => {
  const page: { slot: FakeCanvas | null } = { slot: null };
  const c = new FakeCanvas(page);
  page.slot = c;
  const v = openView(() => c, (x) => new FakeView(x))!;
  v.dispose();
  assert.equal(openView(() => c, (x) => new FakeView(x)), null);
});
