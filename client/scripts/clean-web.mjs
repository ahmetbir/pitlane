// Removes build outputs the production build does not write, so a stale one
// (the source map `npm run watch` leaves) is never embedded and served.
// Single named files only.
import { rmSync } from "node:fs";

for (const f of ["app.js.map"]) {
  rmSync(new URL(`../../cmd/pitlane/web/${f}`, import.meta.url), { force: true });
}
