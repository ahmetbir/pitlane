// Colours of the circuit and the cars, in one place.

export const SKY = { zenith: "#4f8fd0", horizon: "#d6e6ef" } as const;
export const FOG = { near: 260, far: 1500 } as const; // m

export const GROUND = {
  asphalt: "#5a5d63",
  grass: "#4f8a3c",
  kerbRed: "#cf2b25",
  kerbWhite: "#efefe9",
  paint: "#f4f4f0",
  checkerDark: "#1b1c1f",
} as const;

export const BUILT = {
  wall: "#c3c6ca",
  wallBand: "#c8352d",
  wallBandAlt: "#f0f0ec",
  tyre: "#1d1e21",
  tyreAlt: "#2c2e33",
  tyreCap: "#d63a2f",
  steel: "#4a4f57",
  panel: "#16181c",
  stand: "#9da2a8",
  roof: "#e9ecef",
  trunk: "#6b4a2f",
  leaf: "#3d6e32",
  leafAlt: "#4f7f3a",
} as const;

export const LIGHT = { off: "#2a0b0b", on: "#ff2418" } as const;

export const CAR = {
  carbon: "#1c1e22",
  tyre: "#141518",
  rim: "#9aa0a8",
  helmet: "#f2d330",
  intake: "#101216",
  accent: "#f4f4f4",
} as const;

/** Spectator shirt colours on the grandstand. */
export const CROWD = ["#d8433a", "#f2f2f2", "#2d5bd8", "#f2c230", "#2f9c5a", "#202226", "#e57a2c", "#7b4fd0"] as const;

const TEAMS = [
  "#e8202a", // red
  "#ff8a00", // orange
  "#f5d000", // yellow
  "#5cc23a", // lime
  "#0b6e4f", // racing green
  "#1fc3d8", // cyan
  "#2450e6", // blue
  "#7b3fe4", // purple
  "#ff5fa8", // pink
  "#d9dde3", // silver
] as const;

/** Team colour of a car id: ten distinct colours, cycling. */
export function teamColour(id: number): string {
  const n = TEAMS.length;
  const i = Number.isFinite(id) ? ((Math.trunc(id) % n) + n) % n : 0;
  return TEAMS[i];
}
