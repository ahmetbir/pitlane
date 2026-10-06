# Pitlane: a multiplayer formula racing game on roomkit

Date: 2026-10-07 · Status: owner decisions from conversation; open points ruled below ([P…])

## 0. Owner decisions (conversation, 2026-10-07)

- A racing game in the browser, built on roomkit (second consumer after Dogfight), its own
  public repository (portfolio).
- Handling: **two models, chosen when the room is created; everyone in a room uses the same
  one**: Sim-like and Arcade. Mathematically modelled, closer to kinematic, with a **car setup
  the player adjusts before the race** (Assetto Corsa Competizione-like, lighter) to which the
  car really responds.
- First version (scope "A"): **one fictional track, Race mode only, bots, dry weather.**
- Controls: **keyboard and gamepad.**
- Car contact: **all three, chosen when the room is created**: ghost (no contact), soft contact
  (push apart, small speed loss, no damage), full physics with damage (wing loss).
- Accepted assumptions: 10 cars, empty places are bots; laps chosen at creation (3/5/8, default
  3); standing start with lights; results then back to the grid; chase and cockpit cameras;
  low-poly light visuals like Dogfight; pilot stats (races, wins, podiums, best lap); no
  single-player mode (alone = racing bots); same netcode shape as Dogfight (authoritative
  server, 60 Hz sim, 30 Hz snapshots, own car predicted).
- Done when: two browser tabs plus bots finish a 3-lap race end to end; both handling models
  and all three contact modes work; smoke and deterministic goldens pass; live on its own host.

Rulings made here (owner may override): **[P1]** name *Pitlane*, repo `ahmetbir/pitlane`,
host `pitlane.ahmetbirinci.dev` (no "F1" trademark in public names). **[P2]** a player joining a
running race takes over the last-placed bot's car; with no bot left the join is refused with
`racing`. **[P3]** stats need a store like Dogfight's: its mechanics move into roomkit as
`ledger` (generic), Pitlane uses it; Dogfight moves onto it later in its own change.

## 1. Architecture

```
pitlane/                        module github.com/ahmetbir/pitlane, requires roomkit + coder/websocket
  cmd/pitlane/                  main: flags, embedded web/, drain, stats handoff (copy of Dogfight's shape)
  cmd/loadtest/                 roomkit loadtest with Pitlane's Script
  internal/car/                 vehicle model: state, setup, step (pure, deterministic)
  internal/track/               track definition (control points), spline sampling, queries
  internal/race/                one race: grid, lights, laps, timing, contact, bots, results
  internal/bot/                 bot driver: racing line, speed profile, steering/throttle control
  internal/protocol/            Pitlane messages (wire)
  internal/match/               room.Game adapter (seats, takeover, welcome, snapshots, stats tally)
  internal/front/               server.Kit + server.Stats
  internal/stats/               Pitlane's stats schema on roomkit/ledger
  internal/golden/              frozen transcripts, as in Dogfight
  client/src/                   TS + Three.js: car (port), track, net, predict, render, input, ui, i18n, audio
  testdata/vectors/             car-step and track vectors written by Go, replayed by TS
  deploy/ scripts/ .github/     Dogfight's blue/green + CI deploy, parameterised by app name
```

Every package below `internal/` is pure except `match`, `front`, `stats` (I/O lives in
`cmd/`). No goroutines inside the simulation; the room actor owns a `race.Race`.

## 2. Vehicle model (`internal/car`, ported 1:1 to `client/src/car`)

**State** (2D, on the track plane): position `x,z` (m), heading `h` (rad), body-frame velocity
`vx` (forward), `vy` (left) (m/s), yaw rate `r` (rad/s), steering angle `δ` (rad, rate-limited),
engine rpm and gear (automatic), damage `{frontWing, rearWing, suspension}` in 0..1.

**Input** per tick: `throttle` 0..1, `brake` 0..1, `steer` −1..1 (quantized to 1/127 on the wire).

**Step** (fixed dt = 1/60 s, semi-implicit Euler, one sub-step): a dynamic bicycle model.

- Slip angles: `αf = δ − atan2(vy + a·r, |vx|+ε)`, `αr = −atan2(vy − b·r, |vx|+ε)` approximated
  without transcendental functions: `α ≈ (v_lat)/(|vx|+ε)` clamped to ±0.6 (small-angle form;
  keeps Go and TS bit-for-bit close).
- **Tire curve** (rational, no `sin/atan`): `F(α) = μ·Fz · 2s/(1+s²)`, `s = α/αpeak`. It rises
  linearly, peaks at `αpeak`, then falls off (the slide). `αpeak` front/rear from setup.
- **Normal loads** `Fz`: static weight split + aero downforce `½ρ·C_L·v²` per axle (from wing
  settings) + longitudinal load transfer (`m·ax·h_cg/L`), distributed by suspension balance.
- **Longitudinal**: drive force from an engine torque curve (piecewise linear table), gear ratio
  set and final drive; brake force split by brake bias; friction circle per axle
  (`sqrt(Fx²+Fy²) ≤ μFz`, lateral scaled down when exceeded); drag `½ρ·C_D·v²` from wings;
  rolling resistance.
- **Differential lock** shifts rear lateral capacity under power (more lock → more power
  oversteer on exit).
- **Off track** (grass/gravel from `track.Surface`): μ × 0.55, extra drag; kerbs μ × 0.9.
- **Walls**: the track edge barrier is a line constraint: position projected back, normal
  velocity reflected with restitution 0.2, tangential speed × 0.7; full-contact mode adds damage.

Floating point: only `+ − × ÷ sqrt` in the step; every `a*b+c` written so Go cannot fuse it
across platforms where it matters (explicit `float64()` on products), goldens per `GOARCH` as in
Dogfight. TS replays Go vectors within 1e-9 relative (prediction tolerates more; reconcile fixes
drift).

**Setup** (garage, before the race; 6 sliders, integer steps, server-validated ranges):

| setting | range | effect in the model |
|---|---|---|
| front wing | 1..11 | front downforce coefficient; more = front grip, more drag |
| rear wing | 1..11 | rear downforce; more = rear stability, more drag (lower top speed) |
| brake bias | 50..70 % front | front/rear brake split; front-heavy locks fronts (understeer), rear-heavy rotates |
| gearing | 1..5 | final drive: short = acceleration, long = top speed |
| differential | 1..10 | rear lateral capacity loss under throttle: high = power oversteer |
| suspension balance | 1..9 | share of lateral load transfer on the front axle: stiff front = understeer |

Default (bots too): 6 / 6 / 58 / 3 / 5 / 5. Stored in the browser (`pitlane.setup`) and sent with
`ready`; the server clamps and uses it for that player's car for the race.

**Handling models** (room setting, same model, different parameters):

- **Sim**: raw model. μ 1.0, `αpeak` 0.10/0.11 rad, no assists, steering rate 2.5 rad/s.
- **Arcade**: μ 1.25, `αpeak` 0.14/0.15, a slip cap (yaw rate limited to what grip allows at that
  speed), traction control (throttle cut while rear slip > 0.9·αpeak), ABS (brake cut while front
  slip > peak), steering assist (input scaled down with speed, counter-steer toward the velocity
  vector), steering rate 4 rad/s.

## 3. Track (`internal/track`, ported to `client/src/track`)

- Defined by ~24 control points (x, z) of a closed centripetal Catmull–Rom spline, width 14 m,
  plus a per-point camber-free elevation of 0 (flat in v1). Fictional layout "Kıyı Pisti"
  (~4.1 km): a long straight, a hairpin, an esses section, a fast sweeper, a chicane.
- Sampled once into 2 m segments: centre, tangent, normal, cumulative distance `s`, curvature.
  Queries: nearest segment (windowed search from the previous one, O(1) per car per tick),
  lateral offset, surface (`asphalt | kerb | grass | wall`).
- Timing: start/finish line at `s = 0`; 3 sectors. A lap counts only if every sector was passed
  in order; a lap that spent > 2 s with all four wheels beyond the kerb is **invalid** (counts for
  the race, not for best-lap boards).
- Grid: 10 slots behind the line, staggered 2 × 5, 8 m apart.

## 4. Race (`internal/race`)

Phases: `grid` (waiting; starts when every human pressed ready, or 30 s after the first human
joined, or immediately when the room creator presses start) → `lights` (5 lights, 1 s apart,
random 0.2–1.2 s hold, then out; a car moving more than 0.5 m before lights out gets a 5 s
penalty) → `racing` → `finish` (after the leader finishes, others finish their lap; 45 s cap) →
`results` (15 s) → `grid` again with the same room settings.

- Positions by (laps completed, `s`, time). Gaps computed at timing lines.
- **Contact** (room setting):
  - `ghost`: no car–car interaction; other cars drawn translucent within 15 m.
  - `soft`: cars are discs (r = 1.6 m). Overlap → positions separated along the normal, relative
    normal velocity removed, each car loses 5 % speed. No damage.
  - `full`: cars are oriented boxes 5.4 × 1.9 m. SAT overlap → impulse with restitution 0.25 and
    friction 0.4, angular impulse; damage += impulse/threshold to the hit side (front wing on
    front hits, rear wing on rear hits, suspension on side hits). Front wing damage > 0.6 → the
    wing is lost (front downforce − 70 %, visual). Damage persists for the race; resets on grid.
  - Collision is resolved on the server only. The client predicts its own car alone; contact
    arrives as a correction (reconcile smooths it).
- **Takeover [P2]**: a human joining during `lights|racing|finish` takes the last-placed bot's
  car (position, laps, damage kept; stats count from that moment). No bot left: refused
  (`racing`). Leaving mid-race: the car becomes a bot again.

## 5. Bots (`internal/bot`)

- Racing line: the centre line offset by an optimiser run once per track at start-up (iterative
  smoothing of lateral offsets that minimises curvature within the track width minus 1.5 m).
- Target speed per segment from curvature `v = sqrt(μ_eff·g / κ)` with downforce, then a
  backward pass for braking and a forward pass for acceleration.
- Control: pure-pursuit steering to a look-ahead point (distance ∝ speed); throttle/brake from
  speed error. Skill 0.90–0.98 scales target speeds (seeded per bot); overtaking: shift line by
  ±3 m when a car within 12 m ahead is slower.
- Bots use the room's handling model and the default setup, and press nothing a human could not.

## 6. Protocol (`internal/protocol`, version 1)

roomkit envelope; game fields:

| client | fields |
|---|---|
| `create` | `handling: "arcade"\|"sim"`, `contact: "ghost"\|"soft"\|"full"`, `laps: 3\|5\|8`, `listed` |
| `in` | `seq`, `th` 0..100, `br` 0..100, `st` −127..127, `cam` (none) |
| `ready` | `setup: [fw, rw, bb, gear, diff, susp]` (ClassChoice) |
| `start` | creator only, in `grid` (ClassChoice) |

| server | fields |
|---|---|
| `welcome` | roomkit welcome fields + room settings, track id, your car id |
| `snap` (30 Hz) | `tick`, `ack`, `phase`, `t` (race clock ms), `cars: [[id, x·100, z·100, h·1000, vx·100, vy·100, r·1000, δ·1000, lap, s·10, flags], …]` |
| `grid` | per car: id, name, bot, setup-ready |
| `lights` | lights on count, out at tick |
| `lap` | car id, lap, time ms, valid, best |
| `results` | rows: pos, id, name, laps, total ms, best ms, penalties |

Snapshots are evictable (`wsconn.Replaceable`); `lap` and `results` are not.

## 7. Stats [P3]

`roomkit/ledger`: a single-writer actor over a JSON-lines journal and a periodic snapshot with the
stats directory flock and drain handoff (`drain.Handoff`), generic over a delta `D` and a record
`R` (`fold(R, D) R`), with eviction by idle time and pilot cap — the mechanics of Dogfight's
`internal/stats`, without its schema. Pitlane's schema: per pilot races, wins, podiums, laps,
best valid lap per track (ms), week key. Boards (`server.BoardID`): `{week|all, ""}` ranked by
wins then podiums; `{all, "kiyi"}` and `{week, "kiyi"}` ranked by best lap. Only humans
counted; bots never.

## 8. Client

- **Screens**: lobby (room list with handling/contact/laps, create dialog, quick play), garage
  (6 sliders with a one-line effect description each, reset to default), grid (cars, ready
  state), race HUD (position, lap x/y, current/last/best lap, delta to best, gap ahead/behind,
  speed, gear, rpm bar, 3 sector colours, mini-map), results, leaderboard (wins and best laps),
  settings (controls, camera, volume, language). tr/en with roomkit i18n.
- **Render** (Three.js): track ribbon from the sampled spline (asphalt, kerb stripes, grass
  plane, barriers, start gantry with lights), procedural low-poly car (monocoque, wings, four
  wheels that steer and spin, team colour by car id), skybox colour, shadows off on mobile-class
  GPUs. Lost front wing shown.
- **Cameras**: chase (spring follow) and cockpit (`C` toggles). Rear view on hold `R`.
- **Input**: keyboard (arrows/WASD, smoothed to analogue: steer slews 3/s toward the key, back to
  centre 5/s; throttle/brake ramp), gamepad (standard mapping: RT throttle, LT brake, left stick
  steer with deadzone 0.08), all rebindable later (not v1).
- **Netcode**: roomkit `Socket`, shaper, `Reconciler` with the car model (own car), interpolation
  100 ms behind for others.
- **Audio**: engine tone from rpm (two detuned oscillators through a low-pass), tyre squeal from
  slip, contact thump.

## 9. Deploy

Own container colours `pitlane-blue/green`, data volume `pitlane-data`, edge network
`pitlane_edge`, nginx vhost on the same box (Cloudflare proxied, AOP enforced, CF-only geo), DNS
`pitlane` A record proxied. Dogfight's `deploy.sh`, `switch-upstream.sh`, `ci-deploy.sh` and CI
workflow, with every `dogfight` name taken from `APP`. Production environment with the owner as
the only reviewer.

## 10. Testing

- Go: car step unit tests (straight-line acceleration to a computed top speed per gearing,
  braking distance per bias, steady-state cornering radius vs setup, arcade vs sim slip cap),
  track queries, race phases and timing, contact resolution per mode, takeover, bot completes a
  lap under a time bound on both handling models, protocol golden transcripts (seeded race with
  bots), stats deltas.
- Cross-language: Go writes car-step vectors (random inputs and setups, both models) and track
  samples; TS replays them.
- Client: reconcile/interp with latency and jitter, input smoothing, HUD formatting, i18n keys.
- End to end: `scripts/smoke.sh` (loadtest players racing), and a headless browser check of the
  race screen once.

## 11. Out of v1

Qualifying, time trial with ghost, more tracks, weather, DRS/slipstream, pit stops, tyre wear,
fuel, mobile touch, replays, rebinding UI.
