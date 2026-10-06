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
bash scripts/smoke.sh          # once cmd/pitlane exists
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
- **Wire.** Protocol version 1 in `internal/protocol` and `client/src/net/protocol.ts`, changed
  together. Notice and refusal codes never collide with roomkit's (tested). Snapshots start
  `{"t":"snap","tick":`.
- **Storage keys** start with `pitlane.`; never rename one.
- **Secrets** never enter git (`deploy/deploy.env`, `.env*`, keys).
