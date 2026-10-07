# Pitlane

A browser multiplayer formula racing game: up to 10 cars (empty places are bots) on a
fictional circuit, Arcade or Sim handling and ghost, soft or full-damage contact chosen per
room, and a car setup (wings, brake bias, gearing, differential, suspension balance, traction control) the physics
responds to. Built on [roomkit](https://github.com/ahmetbir/roomkit): a Go server is the only
authority (60 Hz simulation, 30 Hz snapshots); the TypeScript + Three.js client predicts your car
and is embedded into the Go binary.

Status: playable, ahead of its first public release. Design:
`docs/superpowers/specs/2026-10-07-pitlane-design.md`.

## Features

- Quick race, create a room (handling, contact, laps, listed or private) or join by code; empty
  places are bots, and a player who joins mid-race takes over the last-placed bot.
- A dropped connection gets its own car back within 60 s, place, lap and timing kept.
- Garage setup per driver; chase and cockpit cameras; keyboard or gamepad; engine, tyre and
  contact audio; Turkish and English.
- Lights, jump-start penalties, lap validity (track limits), marshal resets, a 45 s finish
  window and results; a race nobody completes ends after laps × 4 minutes.
- Pilot stats (races, wins, podiums, laps) and leaderboards for this week and all time: wins,
  and best laps on Kıyı per handling (Arcade and Sim apart). A driver who takes over a bot is
  credited only for what they drive.
- A race left without key or pad input for 5 minutes sends the player home.

## Run

```sh
(cd client && npm ci && npm run build)   # Node 22
go run ./cmd/pitlane -addr 127.0.0.1:8095
```

## Test

```sh
go vet ./... && go test -race -count=1 ./...
(cd client && npm run check && npm test && npm run build)
bash scripts/smoke.sh   # 4 bot players against a local server (needs the client build)
```

## Deployment

Static `linux/arm64` binary in Docker containers behind nginx and a CDN/proxy, with zero-downtime
blue/green switching:

```
CDN / proxy (TLS) -> nginx container -> live color (pitlane-blue | pitlane-green)
```

Host-specific values live in `deploy/deploy.env` (gitignored). Copy the template and fill it in:

```sh
cp deploy/deploy.env.example deploy/deploy.env
```

| Key | Meaning |
|---|---|
| `DEPLOY_HOST` | ssh destination (an alias from `~/.ssh/config`), or `local` to run on this machine |
| `DEPLOY_DIR` | Server directory for compose/env files, the deploy lock and backups (e.g. `/srv/pitlane`) |
| `NGINX_CONTAINER` | nginx container that proxies the game |
| `NGINX_CONF` | Vhost file holding the `set $pitlane_upstream ...;` line (single-file bind mount) |
| `EDGE_NETWORK` | Docker network shared with nginx and nothing else (e.g. `pitlane-edge`); created internal if missing |
| `PUBLIC_HOST` | Public host name (e.g. `pitlane.example.com`): `-origin` and `-public-origin=wss://...` |
| `DRAIN_MAX` | How long a draining color keeps its players (e.g. `30m`) |

A missing file or unset key makes `scripts/deploy.sh` stop without doing anything. Environment
variables win over the file; `DEPLOY_ENV` names another file.

### Release and deploy

```sh
scripts/release.sh                      # dist/pitlane-linux-arm64 + dist/VERSION (clean tree, Go per go.mod, Node 22)
scripts/deploy.sh                       # make the dist/ build live
scripts/deploy.sh --status              # live color, versions, open sockets
scripts/deploy.sh --doctor              # check invariants (exit 1 on a problem)
scripts/deploy.sh --rollback <version>  # make a version already on the server live again
scripts/deploy.sh --preflight-network [host:port | https://url ...]  # set up and prove EDGE_NETWORK
```

nginx's live color is the single `set $pitlane_upstream http://pitlane-<color>:8080;` line in
`NGINX_CONF`. A deploy builds `pitlane:<version>` on the server, starts it in the idle color,
waits for its health check, checks that nginx reaches `/healthz`, switches nginx
(`deploy/switch-upstream.sh`: in-place rewrite, `nginx -t`, reload, restore on failure), then
drains the old color with `SIGUSR1` (its players finish their rooms, the stats lock moves over
at once). Deploy, rollback and `switch-upstream.sh` hold a `flock` on `$DEPLOY_DIR/deploy.lock`.
Only the containers `pitlane-blue` and `pitlane-green` and the `pitlane:<version>` images are
touched, by exact name. Set `DRAIN_WAIT=<seconds>` to wait for a still-draining idle color.

### Known limitations

- **Stats during a drain.** The draining color hands the stats lock to the new color at once,
  so a race that ends on the draining color (a race running at the deploy, and any its players
  start before they leave, up to `DRAIN_MAX`) records nothing; the `dropped` metric counts
  them. Accepted, as in Dogfight.
- **Reconnects during a drain.** A connection blip on the draining color gets the update close
  (1012); the new color does not have that room, so the player sees "room gone" and starts
  again from home.

### Deploy from CI (optional)

`.github/workflows/ci.yml` tests every push and pull request; a push to `main` also builds the
release and deploys it after the `production` environment's reviewer approves.

1. Create the GitHub environment `production` (required reviewer, `main` only); protect `main`.
2. On the server, install `deploy/ci-deploy.sh` as `<DEPLOY_DIR>/ci/ci-deploy.sh` (root, mode
   700) next to a `deploy.env` with `DEPLOY_HOST=local`.
3. Add a dedicated ed25519 public key to `authorized_keys` as
   `command="<DEPLOY_DIR>/ci/ci-deploy.sh",restrict ssh-ed25519 ...`.
4. Store `DEPLOY_SSH_KEY`, `DEPLOY_SSH_HOST` and `DEPLOY_KNOWN_HOSTS` as secrets of the
   `production` environment.

The bundle holds `dist/pitlane-linux-arm64`, `dist/VERSION`, `Dockerfile.runtime`,
`deploy/compose.yml`, `deploy/switch-upstream.sh` and `scripts/deploy.sh`; `ci-deploy.sh`
refuses anything else. Rollbacks stay manual.

### Container settings (`deploy/compose.yml`)

- Read-only root, user 65532, `cap_drop: ALL`, `no-new-privileges`; 256 MB, 1 CPU, 128 pids.
- No published ports: the container joins `EDGE_NETWORK` under its own name; only that network's
  IPv4 subnet is passed as `-trust-proxy`.
- `-max-conns=96 -max-rooms=8` (not yet load-tested; measure your hardware).
- `-data=/data` on the external volume `pitlane-data` (created by the deploy; never `down -v`).
- `-metrics-addr=127.0.0.1:9090`, loopback only: `docker exec pitlane-<color> /pitlane -get http://127.0.0.1:9090/metrics`.

### Edge network

If `EDGE_NETWORK` does not exist, the deploy creates it as an internal bridge without a host
IPv4 address and connects `NGINX_CONTAINER` to it, so a game container reaches nginx and the other
color and nothing else. `--doctor` reports when nginx shares no network with the live color;
`--preflight-network` sets the network up and proves it before the first deploy. An existing
network is used as is.

### nginx

`deploy/nginx-pitlane.conf` is a sample vhost for nginx's `http{}` level: replace `server_name`
(`pitlane.example.com`) and the certificate paths. It redirects 80 to 443, accepts only
Cloudflare's IP ranges (`geo` on `$realip_remote_addr`; the list appears twice, keep both in
sync), takes the client IP from `CF-Connecting-IP`, resolves the upstream through docker DNS
(`resolver 127.0.0.11`), proxies `/ws` with upgrade, and ships Authenticated Origin Pulls
commented out. Run `nginx -t` before reloading. Certificates and keys never enter the repository.

Agents and contributors: read [AGENTS.md](AGENTS.md).

## License

MIT
