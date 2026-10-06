# Pitlane

A browser multiplayer formula racing game: up to 10 cars (empty places are bots) on a
fictional circuit, Arcade or Sim handling and ghost, soft or full-damage contact chosen per
room, and a car setup (wings, brake bias, gearing, differential, suspension balance) the physics
responds to. Built on [roomkit](https://github.com/ahmetbir/roomkit): a Go server is the only
authority (60 Hz simulation, 30 Hz snapshots); the TypeScript + Three.js client predicts your car
and is embedded into the Go binary.

Status: in development. Design: `docs/superpowers/specs/2026-10-07-pitlane-design.md`.

## Run

```sh
(cd client && npm ci && npm run build)   # Node 22
go run ./cmd/pitlane -addr 127.0.0.1:8095
```

## Test

```sh
go vet ./... && go test -race ./...
(cd client && npm run check && npm test)
```

Agents and contributors: read [AGENTS.md](AGENTS.md).

## License

MIT
