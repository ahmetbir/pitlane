# Notes for agents and contributors

Pitlane is a racing game on [roomkit](https://github.com/ahmetbir/roomkit). roomkit's own
`AGENTS.md` holds the core invariants (room actor, rate limits, wire codes, security); this file
holds Pitlane's.

## Setup

- Go 1.26 (`toolchain go1.26.8` in `go.mod`); Node 22 for the client (`node
  --experimental-strip-types --test`; Node 20 cannot run the tests).
- `cd client && npm ci`. Runtime deps: `three`, `roomkit` (pinned tag over `git+https`).
- roomkit changes: point Pitlane at a checkout beside it on a local branch only
  (`go mod edit -replace github.com/ahmetbir/roomkit=../roomkit`, `npm install ../../roomkit`),
  then tag roomkit and pin the tag.

## Test

```sh
go vet ./... && go test -race -count=1 ./...
(cd client && npm run check && npm test && npm run build)
bash scripts/smoke.sh          # after the client build: 4 bot players, gaps and disconnects
```

## Invariants

- **Determinism.** `internal/car`, `internal/track`, `internal/race`, `internal/bot`: no
  `time.Now`, goroutines, map-order iteration or global randomness; RNG is splitmix64 seeded from
  the room settings. Goldens are per `GOARCH` (arm64 floats fuse multiply-adds).
- **The car step is portable.** Only `+ - * / sqrt` and comparisons inside `car.Step`; products
  that feed sums are materialised (`x := float64(a * b)`) so Go cannot fuse them. The TS port in
  `client/src/car` replays Go-written vectors (`testdata/vectors`).
- **The server owns contact.** The client predicts its own car alone; car-to-car contact arrives
  as a correction.
- **Wire.** Protocol version 2 in `internal/protocol` and `client/src/net/protocol.ts`, changed
  together. Notice and refusal codes never collide with roomkit's (tested). Snapshots start
  `{"t":"snap","tick":`.
- **Storage keys** start with `pitlane.`; never rename one.
- **Deploy.** README [Deployment](README.md#deployment); `scripts/deploy.sh` (blue/green, `pitlane-blue/green`,
  `$pitlane_upstream`) reads the gitignored `deploy/deploy.env`; CI deploys `main` via
  `deploy/ci-deploy.sh` after approval. Use `deploy/deploy.env.example` placeholders in docs.
- **Stats credit.** A pilot is credited from the takeover on (`race.Credit`), never while away
  (a reconnect resumes with the next lap): laps driven, best of the laps driven from the line, a
  race only with their own flag after one full lap of their own. Recorded at Results, or when a
  finisher leaves before it; once per pilot and race. Best laps are keyed `kiyi-<handling>`.
- **Known limitations** (accepted): stats of races ending on a draining color are dropped, and a
  reconnect to a draining color's room gets "room gone" (README Deployment).
- **Secrets** never enter git (`deploy/deploy.env`, `.env*`, keys).
