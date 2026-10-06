// A fresh canvas for every race: a disposed Stage forces its WebGL context
// lost, and a lost context cannot be reused, so the old element is replaced
// by a new one in place (same id, same position in the page).

/** The part of a canvas element the swap needs. */
export type Swappable<C> = { id: string; replaceWith(next: C): void };

/** Replaces old with make()'s element (same id) and returns the new one. */
export function swapCanvas<C extends Swappable<C>>(old: C, make: () => C): C {
  const next = make();
  next.id = old.id;
  old.replaceWith(next);
  return next;
}

/** build(canvas()), or null when it throws (no WebGL, a lost context): the caller shows the no-WebGL card. */
export function openView<C, V>(canvas: () => C, build: (c: C) => V): V | null {
  try {
    return build(canvas());
  } catch {
    return null;
  }
}

/** Whether WebGL works here; the probe context is released at once. */
export function hasWebGL(doc: Pick<Document, "createElement"> = document): boolean {
  try {
    const c = doc.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
