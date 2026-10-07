#!/usr/bin/env bash
# Zero-downtime (blue/green) deploy of dist/ (from scripts/release.sh) to
# the server, or a rollback. Settings (host, directories, nginx, network,
# public host name) come from deploy/deploy.env (gitignored; template
# deploy/deploy.env.example; DEPLOY_ENV names another file).
#   scripts/deploy.sh                      ship dist/pitlane-linux-arm64 as dist/VERSION
#   scripts/deploy.sh --rollback <version> make a version already on the server live again
#   scripts/deploy.sh --status             colors, versions, open sockets
#   scripts/deploy.sh --doctor             invariants: nginx's target runs healthy, one live
#                                          color, nginx shares a network with it, nginx -t (exit 1 on a problem)
#   scripts/deploy.sh --preflight-network [host:port | https://url ...]
#                                          set up EDGE_NETWORK and prove it before any deploy
#                                          uses it (see preflight_network)
#
# Lock: deploys, rollbacks and switch-upstream.sh hold flock on
# $DIR/deploy.lock on the server for their whole run; a second one fails at
# once ("another deploy ... is running").
#
# Two colors, containers pitlane-blue and pitlane-green (compose projects
# of the same names), on the docker network EDGE_NETWORK (shared with the
# nginx container only; created internal if missing, see edge_network)
# under their own names; no published port. Which color is live is
# whatever nginx routes to: the one line
#   set $pitlane_upstream http://pitlane-<color>:8080;
# in NGINX_CONF. Only the containers pitlane-blue and pitlane-green are
# ever touched (by exact name); nothing else on the box. A deploy:
#   1. starts the new version in the idle color and waits for its healthcheck
#      (the live color is untouched; an unhealthy start is stopped, nothing
#      else changes),
#   2. switches nginx to it (deploy/switch-upstream.sh: in-place rewrite,
#      nginx -t, reload; restored on failure). Existing WebSockets stay on the
#      old color (old nginx workers keep them); new ones reach the new color,
#   3. drains the old color: restart policy `no`, SIGUSR1. It keeps its
#      players, refuses newcomers (close 1012: the client reconnects to the new
#      color), hands the stats lock over at once and exits when its last
#      player has left or after DRAIN_MAX (30 min). Nothing waits for it.
# A rollback is the same with an existing image; if the version runs in the
# idle color (still draining), it is undrained (SIGUSR2) and switched back.
#
# Pilot stats: the external volume pitlane-data at /data, shared by both
# colors; the server's flock on /data/stats.lock admits one writer, the new
# color's store opens when the old color hands the lock over. Never removed
# here (no `down -v`, external volume).
#
# Layout on the server (DIR):
#   compose-<v>.yml  version v's compose file (its flags)
#   env-<color>      VERSION, COLOR, EDGE_NETWORK, TRUST_PROXY, PUBLIC_HOST for that color
#   version-<color>  the version last started in that color
#   current/previous the live version and the one before it
#   switch-upstream.sh, <conf>.bak.* (last 10 switches)
# Back up the stats volume with:
#   docker run --rm -v pitlane-data:/data:ro -v "$PWD":/b busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e tar czf /b/pitlane-data.tgz -C /data .
set -euo pipefail
cd "$(dirname "$0")/.."

BUSYBOX=busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e
NETPROBE=pitlane-netprobe # --preflight-network's throwaway server on EDGE_NETWORK
# Throwaway busybox probes run unprivileged, read-only and small.
PROBE_OPTS="--rm --read-only --cap-drop ALL --security-opt no-new-privileges:true --user 65532:65532 --memory 16m --pids-limit 16"
# NCPROBE (sh, args host:port...): one "<target> REACHED|no" line per target.
NCPROBE='for t in "$@"; do if nc -z -w 3 "${t%:*}" "${t##*:}" 2>/dev/null; then echo "$t REACHED"; else echo "$t no"; fi; done'

die() { echo "deploy: $*" >&2; exit 1; }

# static_arm64 FILE: a 64-bit little-endian ELF executable for aarch64 with
# no program interpreter (statically linked). Reads the header with od, so
# it needs no `file` (absent on minimal servers, where CI deploys run).
static_arm64() {
  local h
  h="$(od -An -tx1 -N20 "$1" | tr -d ' \n')" || return 1
  # 7f454c46 = \x7fELF, 02 = 64-bit, 01 = little-endian; e_type (offset 16)
  # 0200 = executable; e_machine (offset 18) b700 = aarch64.
  [[ "$h" == 7f454c460201* && "${h:32:4}" == 0200 && "${h:36:4}" == b700 ]] || return 1
  ! LC_ALL=C grep -q -a 'ld-linux' "$1"
}

# load_env FILE: KEY=value lines of the known keys; the environment wins.
load_env() {
  local line k
  [[ -f "$1" ]] || die "missing $1: copy deploy/deploy.env.example to deploy/deploy.env and fill it in"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" =~ ^(DEPLOY_HOST|DEPLOY_DIR|NGINX_CONTAINER|NGINX_CONF|EDGE_NETWORK|PUBLIC_HOST|DRAIN_MAX)=([^[:space:]\'\"]*)$ ]] ||
      die "bad line in $1 (KEY=value, known keys only, no quotes or spaces): $line"
    k="${BASH_REMATCH[1]}"
    [[ -n "${!k:-}" ]] || printf -v "$k" '%s' "${BASH_REMATCH[2]}"
  done <"$1"
}
load_env "${DEPLOY_ENV:-deploy/deploy.env}"
for k in DEPLOY_HOST DEPLOY_DIR NGINX_CONTAINER NGINX_CONF EDGE_NETWORK PUBLIC_HOST DRAIN_MAX; do
  [[ -n "${!k:-}" ]] || die "$k is not set (${DEPLOY_ENV:-deploy/deploy.env})"
done
HOST="$DEPLOY_HOST" # "local": run on this machine (tests)
DIR="$DEPLOY_DIR"
NGINX="$NGINX_CONTAINER"
CONF="$NGINX_CONF" # single-file bind mount of $NGINX's vhost config
isversion() { [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]]; }
valid() { isversion "$1" || die "bad version '$1'"; }
# fd 8 (the deploy lock's pipe, lock_box) is closed in every child, so only
# this script's exit releases the lock. Once the lock is held, every remote
# command first checks that the session holding it is still alive: if that
# ssh dropped alone, the box is no longer locked and the script stops.
LOCK_OUT=""
MAIN_PID=$$
# Lock loss stops the main script even from inside a $(...) subshell (whose
# stderr may be discarded): the message comes from this TERM trap.
trap 'echo "deploy: STOPPED: the ssh session holding $DIR/deploy.lock dropped, the box is no longer locked; nothing more was changed after that (run $0 --status)" >&2; exit 1' TERM
remote() {
  if [[ -n "$LOCK_OUT" ]] && grep -q released "$LOCK_OUT"; then
    kill -TERM "$MAIN_PID"
    exit 1
  fi
  if [[ "$HOST" == local ]]; then bash -c "$*" 8>&-; else ssh "$HOST" "$@" 8>&-; fi
}
ship() { if [[ "$HOST" == local ]]; then cp "$1" "$2"; else scp -q "$1" "$HOST:$2"; fi; }

[[ "$HOST" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]*$ ]] || die "bad DEPLOY_HOST '$HOST'"
[[ "$EDGE_NETWORK" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "bad EDGE_NETWORK '$EDGE_NETWORK'"
[[ "$NGINX" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "bad NGINX_CONTAINER '$NGINX'"
[[ "$PUBLIC_HOST" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]+)?$ ]] || die "bad PUBLIC_HOST '$PUBLIC_HOST'"
[[ "$DIR" =~ ^/[A-Za-z0-9/_.-]+$ && "$CONF" =~ ^/[A-Za-z0-9/_.-]+$ ]] || die "bad DEPLOY_DIR or NGINX_CONF"
[[ "$DRAIN_MAX" =~ ^([0-9]+)([smh])$ ]] || die "bad DRAIN_MAX '$DRAIN_MAX' (e.g. 30m)"

# lock_box: hold flock on $DIR/deploy.lock on the server until this script
# exits (a remote `cat` reads fd 8 until EOF); refuse if it is taken.
lock_box() {
  local out i got=""
  out="$(mktemp "${TMPDIR:-/tmp}/pitlane-deploy-lock.XXXXXX")"
  trap "rm -f '$out'" EXIT
  # The local side appends "released" when the lock session ends for any reason.
  exec 8> >(remote "mkdir -p '$DIR' && flock -n '$DIR/deploy.lock' -c 'echo locked; exec cat >/dev/null' || echo busy" >"$out" 2>&1; echo released >>"$out")
  for i in $(seq 1 75); do
    got="$(cat "$out")"
    [[ -n "$got" ]] && break
    sleep 0.2
  done
  if [[ "$got" == locked* ]]; then
    LOCK_OUT="$out"
    return 0
  fi
  [[ "$got" == busy* ]] && die "another deploy, rollback or switch is running on $HOST ($DIR/deploy.lock); nothing changed"
  die "cannot take $DIR/deploy.lock on $HOST: ${got:-no answer}"
}

# networks NAME: the docker networks a container is attached to, one per
# line ("" if it does not exist).
networks() { remote "docker inspect -f '{{range \$k, \$v := .NetworkSettings.Networks}}{{\$k}}{{println}}{{end}}' '$1' 2>/dev/null" || true; }

# edge_network: make sure EDGE_NETWORK exists and the nginx container is on
# it. A missing network is created as an internal bridge whose bridge has no
# IPv4 address: no route out (the game needs no egress) and no way to the
# host's own ports, so a container on it reaches only its peers (nginx and
# the other color). nginx is connected to it and keeps its other networks
# (never disconnected here); a color already running elsewhere stays
# reachable through them. An existing network is used as it is.
edge_network() {
  remote "docker network inspect '$EDGE_NETWORK' >/dev/null 2>&1 || docker network create --driver bridge --internal -o com.docker.network.bridge.inhibit_ipv4=true '$EDGE_NETWORK' >/dev/null" ||
    die "cannot create docker network $EDGE_NETWORK on $HOST"
  if ! grep -qxF "$EDGE_NETWORK" <<<"$(networks "$NGINX")"; then
    echo "deploy: connecting $NGINX to $EDGE_NETWORK"
    remote "docker network connect '$EDGE_NETWORK' '$NGINX'" || die "cannot connect $NGINX to docker network $EDGE_NETWORK"
  fi
  [[ "$(remote "docker network inspect -f '{{.Internal}}' '$EDGE_NETWORK'" || true)" == true ]] ||
    echo "deploy: note: $EDGE_NETWORK is not an internal network; the game can reach whatever else is on it (see README, Deployment)" >&2
}

# edge_subnet: the IPv4 subnet of EDGE_NETWORK on the server; fails if unknown.
edge_subnet() {
  local out s
  out="$(remote "docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' '$EDGE_NETWORK'")" ||
    die "cannot inspect docker network $EDGE_NETWORK on $HOST"
  for s in $out; do
    if [[ "$s" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]]; then
      printf '%s' "$s"
      return 0
    fi
  done
  die "no IPv4 subnet on docker network $EDGE_NETWORK"
}

# reach NAME URL: GET URL from inside container NAME's network namespace (a
# throwaway busybox), so over exactly the networks NAME is on; 0 on a 200.
reach() { remote "docker run $PROBE_OPTS --network 'container:$1' '$BUSYBOX' wget -q -T 5 -O /dev/null '$2'" >/dev/null 2>&1; }

# state NAME: the version stored in $DIR/NAME, or "" (validated: it goes back
# into remote commands).
state() {
  local v
  v="$(remote "cat '$DIR/$1' 2>/dev/null" || true)"
  if [[ -n "$v" ]] && ! isversion "$v"; then
    die "unexpected content in $DIR/$1"
  fi
  printf '%s' "$v"
}

# live: the color container nginx routes to (pitlane-blue or
# pitlane-green), from the one upstream line in CONF.
live() {
  local l
  l="$(remote "grep -E '^[[:space:]]*set[[:space:]]+[\$]pitlane_upstream[[:space:]]+http://pitlane-(blue|green):8080;' '$CONF'")" ||
    die "no pitlane-blue/green upstream line in $CONF on $HOST"
  [[ "$(wc -l <<<"$l")" -eq 1 ]] || die "more than one pitlane upstream line in $CONF"
  [[ "$l" =~ http://(pitlane-(blue|green)):8080 ]] || die "unreadable upstream line: $l"
  printf '%s' "${BASH_REMATCH[1]}"
}

# info NAME: "<running> <image> <restart policy>" of a container, or "".
info() { remote "docker inspect -f '{{.State.Running}} {{.Config.Image}} {{.HostConfig.RestartPolicy.Name}}' '$1' 2>/dev/null" || true; }

# conns NAME: the container's open game sockets (its loopback metrics), or "?".
conns() {
  local n
  n="$(remote "docker exec '$1' /pitlane -get http://127.0.0.1:9090/metrics 2>/dev/null" | awk '$1 == "pitlane_conns" { print $2 }' || true)"
  printf '%s' "${n:-?}"
}

# bluegreen V: V's compose file runs in a color (drain + stats lock).
bluegreen() {
  remote "test -f '$DIR/compose-$1.yml'" || die "no $DIR/compose-$1.yml on $HOST (version never shipped, or cleaned up)"
  remote "grep -q '^# bluegreen: 1' '$DIR/compose-$1.yml'" ||
    die "$1 predates blue/green (no '# bluegreen: 1' in compose-$1.yml); see README (Geri dönüş)"
}

# compose COLOR ARGS...: docker compose for COLOR with its env file (which
# names the version, hence the compose file).
compose() {
  local color="$1" v; shift
  v="$(state "version-$color")"
  [[ -n "$v" ]] || { echo "deploy: no version recorded for $color" >&2; return 1; }
  remote "cd '$DIR' && docker compose -p 'pitlane-$color' --env-file 'env-$color' -f 'compose-$v.yml' $*"
}

# up COLOR V: start V in COLOR and wait for its healthcheck. Callers use
# `up ... ||`: failure is `return 1`, never exit.
up() {
  local color="$1" v="$2" status="" i subnet out cid img
  subnet="$(edge_subnet)" || return 1 # die only ends the $(...) subshell
  remote "printf '%s\n' 'VERSION=$v' 'COLOR=$color' 'EDGE_NETWORK=$EDGE_NETWORK' 'TRUST_PROXY=$subnet' 'DRAIN_MAX=$DRAIN_MAX' 'PUBLIC_HOST=$PUBLIC_HOST' > '$DIR/env-$color' && printf '%s\n' '$v' > '$DIR/version-$color'" || return 1
  compose "$color" up -d --remove-orphans || return 1
  # Pin the container by ID and require V's image before polling its health.
  out="$(remote "docker inspect -f '{{.Id}} {{.Config.Image}}' 'pitlane-$color'")" || return 1
  read -r cid img <<<"$out"
  [[ "$cid" =~ ^[0-9a-f]{64}$ ]] || { echo "deploy: no pitlane-$color container after start" >&2; return 1; }
  [[ "$img" == "pitlane:$v" ]] || { echo "deploy: pitlane-$color runs '$img', not pitlane:$v" >&2; return 1; }
  # compose reuses an unchanged stopped container as is, keeping the `no`
  # its last drain set (a rollback to the version that color last ran).
  remote "docker update --restart=unless-stopped '$cid' >/dev/null" || return 1
  for i in $(seq 1 45); do
    status="$(remote "docker inspect -f '{{.State.Health.Status}}' '$cid'" 2>/dev/null || true)"
    [[ "$status" == healthy ]] && break
    sleep 2
  done
  [[ "$status" == healthy ]]
}

# drain NAME: the container keeps its players, refuses new ones and exits
# when empty (restart policy no, so it stays down).
drain() {
  remote "docker update --restart=no '$1' >/dev/null && docker kill -s USR1 '$1' >/dev/null" ||
    echo "deploy: WARNING: could not send drain to $1" >&2
}

# stats_report COLOR SINCE: how the new color's stats store came up.
stats_report() {
  local name="pitlane-$1" since="$2" logs i
  for i in $(seq 1 15); do
    logs="$(remote "docker logs --since '$since' '$name' 2>&1" || true)"
    if grep -q 'stats disabled' <<<"$logs"; then
      echo "deploy: WARNING: $name runs with stats disabled (check the pitlane-data volume)" >&2
      return
    fi
    if grep -q 'stats opened' <<<"$logs"; then
      echo "deploy: $name stats open"
      return
    fi
    sleep 2
  done
  echo "deploy: $name stats still waiting for the old server's lock (they open when it hands over or exits)"
}

# idle_color: the color a deploy starts (the one nginx does not route to).
idle_color() {
  case "$(live)" in
    pitlane-blue) printf green ;;
    *) printf blue ;; # pitlane-green
  esac
}

# idle_running V: whether the idle color still runs (draining); refuses
# unless it runs V (then the deploy undrains it instead of starting V), or
# waits up to DRAIN_WAIT seconds for an older version to finish draining.
idle_running() {
  local to i waited=0
  to="pitlane-$(idle_color)"
  while :; do
    read -r -a i <<<"$(info "$to")"
    [[ "${i[0]:-}" == true ]] || return 1
    [[ "${i[1]}" == "pitlane:$1" ]] && return 0
    # The idle color still drains an older version: its players keep their
    # match. With DRAIN_WAIT=<seconds> (CI deploys) wait for it to exit
    # instead of failing; nobody is dropped.
    if ((waited >= ${DRAIN_WAIT:-0})); then
      die "$to still runs ${i[1]} with $(conns "$to") open sockets (draining); wait for it to exit, or drop them: docker stop $to"
    fi
    ((waited == 0)) && echo "deploy: $to still drains ${i[1]} ($(conns "$to") open sockets); waiting up to ${DRAIN_WAIT}s for it to exit"
    sleep 30
    waited=$((waited + 30))
  done
}

# promote V: make V live in the idle color and drain the live one.
promote() {
  local v="$1" from to idle i since old now started undrain=0
  from="$(live)"
  idle="$(idle_color)"
  to="pitlane-$idle"
  bluegreen "$v"
  if idle_running "$v"; then undrain=1; fi
  remote "docker volume inspect pitlane-data >/dev/null 2>&1 || docker volume create pitlane-data >/dev/null" ||
    die "cannot create the pitlane-data volume"
  since="$(remote "date -u +%Y-%m-%dT%H:%M:%SZ")"
  echo "deploy: live $from -> $to ($v)"

  if [[ "$undrain" == 1 ]]; then
    started="$(remote "docker inspect -f '{{.State.StartedAt}}' '$to'")"
    remote "docker kill -s USR2 '$to' >/dev/null && docker update --restart=unless-stopped '$to' >/dev/null" ||
      die "cannot undrain $to"
    sleep 1 # a drainer that was just exiting (0 sockets) must not be mistaken for an undrained one
    [[ "$(remote "docker inspect -f '{{.State.Running}} {{.State.StartedAt}}' '$to'" || true)" == "true $started" ]] ||
      die "$to exited or restarted while being undrained; nothing switched, run the rollback again"
  elif ! up "$idle" "$v"; then
    compose "$idle" logs --tail 50 pitlane-bg || true
    compose "$idle" down || true
    die "$v is not healthy in $idle; $from still serves, nothing switched"
  fi

  # The container's own healthcheck is on its loopback; nginx reaches it over
  # EDGE_NETWORK. Prove that path before nginx points at it.
  if ! reach "$NGINX" "http://$to:8080/healthz"; then
    if [[ "$undrain" == 1 ]]; then drain "$to"; else compose "$idle" down || true; fi
    die "$NGINX cannot reach http://$to:8080/healthz over its docker networks ($EDGE_NETWORK?); $from still serves, nothing switched"
  fi

  if ! remote "PITLANE_DEPLOY_LOCK_HELD=1 '$DIR/switch-upstream.sh' '$CONF' '$NGINX' '$to'"; then
    # The failure may be the ssh connection, not the switch: ask the box
    # where nginx points before touching anything.
    now="$(live)" || now=""
    if [[ "$now" == "$to" ]]; then
      remote "docker exec '$NGINX' nginx -t >/dev/null 2>&1 && docker exec '$NGINX' nginx -s reload" ||
        die "$CONF points to $to but nginx could not be reloaded; nothing stopped (both colors run): check $NGINX by hand"
      echo "deploy: WARNING: the switch reported a failure, but $CONF points to $to and nginx reloaded it; carrying on" >&2
    elif [[ "$now" == "$from" ]]; then
      if [[ "$undrain" == 1 ]]; then drain "$to"; else compose "$idle" down || true; fi
      die "nginx switch failed; $from still serves"
    else
      die "cannot tell where nginx points (connection lost?); nothing stopped, nothing drained: run $0 --status"
    fi
  fi

  read -r -a i <<<"$(info "$from")"
  [[ "${i[0]:-}" == true ]] && drain "$from"
  old="$(state current)"
  if [[ -n "$old" && "$old" != "$v" ]]; then remote "printf '%s\n' '$old' > '$DIR/previous'"; fi
  remote "printf '%s\n' '$v' > '$DIR/current'"
  stats_report "$idle" "$since"
}

# doctor: check the invariants; print every problem; return non-zero if any.
#  - the container nginx routes to is running and healthy, with restart
#    policy unless-stopped (a reboot brings it back)
#  - exactly one live server: the other color, if running, drains
#    (restart policy no)
#  - nginx shares a docker network with the live container
#  - the nginx container's config passes nginx -t
doctor() {
  local up c i n=0
  problem() { echo "doctor: PROBLEM: $*" >&2; n=$((n + 1)); }
  up="$(live)"
  read -r -a i <<<"$(remote "docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.HostConfig.RestartPolicy.Name}}' '$up' 2>/dev/null" || true)"
  if [[ "${i[0]:-}" != running || "${i[1]:-}" != healthy ]]; then
    problem "nginx routes to $up, which is ${i[0]:-missing}/${i[1]:-?}: pitlane is down"
  elif [[ "${i[2]:-}" != unless-stopped ]]; then
    problem "$up (live) has restart policy ${i[2]:-?}: it would not come back after a reboot"
  fi
  for c in pitlane-blue pitlane-green; do
    [[ "$c" != "$up" ]] || continue
    read -r -a i <<<"$(info "$c")"
    if [[ "${i[0]:-}" == true && "${i[2]:-}" != no ]]; then
      problem "$c runs (restart ${i[2]:-?}) next to the live $up; a second server should be draining (restart no)"
    fi
  done
  if [[ -z "$(comm -12 <(networks "$up" | sort) <(networks "$NGINX" | sort) | grep .)" ]]; then
    problem "$NGINX shares no docker network with $up (nginx recreated?): docker network connect $EDGE_NETWORK $NGINX"
  fi
  remote "docker exec '$NGINX' nginx -t >/dev/null 2>&1" || problem "nginx -t fails in $NGINX: do not reload or restart it"
  if [[ "$n" == 0 ]]; then echo "doctor: ok (live $up)"; else echo "doctor: $n problem(s)" >&2; fi
  [[ "$n" == 0 ]]
}

# preflight_network [TARGET...]: set up EDGE_NETWORK (edge_network) and prove
# it before a deploy moves the game onto it. TARGETs: host:port services the
# game must NOT reach (other containers' IPs, the host's public IP), and
# https:// URLs (other vhosts) that must answer 200 before and after; they
# are fetched from this machine. Checks:
#   1. nginx's default route (seen from its netns) is unchanged;
#   2. nginx reaches a throwaway server on EDGE_NETWORK by name;
#   3. that server reaches none of the targets nor 1.1.1.1:443, each
#      shown next to what nginx reaches (a target nginx cannot reach either
#      proves nothing and is flagged);
#   4. every URL still answers 200; nginx -t passes.
# On a failure it undoes what this run added (nginx's connection, the
# network if it created it). Returns non-zero on any failure.
preflight_network() {
  local t ports="" urls=() route0 route1 created=0 connected=0 fail=0 out code line ctl
  for t in "$@"; do
    if [[ "$t" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$ ]]; then urls+=("$t")
    elif [[ "$t" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*:[0-9]{1,5}$ ]]; then ports+=" $t"
    else die "bad preflight target '$t' (host:port or https://host/path)"; fi
  done
  ports+=" 1.1.1.1:443"
  bad() { echo "preflight: FAIL: $*" >&2; fail=1; }
  for t in ${urls[@]+"${urls[@]}"}; do
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$t" || true)"
    [[ "$code" == 200 ]] || die "$t answers $code before anything changed; fix that first"
  done
  route0="$(remote "docker run $PROBE_OPTS --network 'container:$NGINX' '$BUSYBOX' ip -4 route show default")" ||
    die "cannot read $NGINX's routes"
  remote "docker network inspect '$EDGE_NETWORK' >/dev/null 2>&1" || created=1
  grep -qxF "$EDGE_NETWORK" <<<"$(networks "$NGINX")" || connected=1
  edge_network
  echo "preflight: $EDGE_NETWORK $(remote "docker network inspect -f 'internal={{.Internal}} subnet={{range .IPAM.Config}}{{.Subnet}}{{end}} {{json .Options}}' '$EDGE_NETWORK'")"

  route1="$(remote "docker run $PROBE_OPTS --network 'container:$NGINX' '$BUSYBOX' ip -4 route show default")" || route1="?"
  if [[ "$route1" == "$route0" ]]; then echo "preflight: ok: $NGINX default route unchanged ($route0)"
  else bad "$NGINX default route changed: '$route0' -> '$route1'"; fi

  # --rm plus a 300 s timeout: the probe removes itself even if this run is
  # interrupted (or loses its lock) before the explicit removal below.
  remote "docker rm -f '$NETPROBE' >/dev/null 2>&1; docker run -d --name '$NETPROBE' $PROBE_OPTS --tmpfs /w:size=64k,uid=65532 --network '$EDGE_NETWORK' '$BUSYBOX' sh -c 'echo ok > /w/index.html && exec timeout 300 httpd -f -p 8080 -h /w' >/dev/null" ||
    bad "cannot start $NETPROBE on $EDGE_NETWORK"
  sleep 1
  if reach "$NGINX" "http://$NETPROBE:8080/"; then echo "preflight: ok: $NGINX reaches $NETPROBE over $EDGE_NETWORK"
  else bad "$NGINX cannot reach http://$NETPROBE:8080/ over $EDGE_NETWORK"; fi

  # shellcheck disable=SC2086 # $ports is a list of validated host:port words
  out="$(remote "docker run $PROBE_OPTS --network 'container:$NETPROBE' '$BUSYBOX' sh -c '$NCPROBE' x $ports")" || bad "isolation probe did not run"
  ctl="$(remote "docker run $PROBE_OPTS --network 'container:$NGINX' '$BUSYBOX' sh -c '$NCPROBE' x $ports")" || ctl=""
  while read -r t line; do
    [[ -n "$t" ]] || continue
    if [[ "$line" == REACHED ]]; then bad "the edge network reaches $t"
    elif grep -qxF "$t REACHED" <<<"$ctl"; then echo "preflight: ok: $t not reachable from $EDGE_NETWORK (nginx reaches it)"
    else echo "preflight: note: $t not reachable from $EDGE_NETWORK, but nginx cannot reach it either (proves nothing)"; fi
  done <<<"$out"
  remote "docker rm -f '$NETPROBE' >/dev/null 2>&1" || true

  for t in ${urls[@]+"${urls[@]}"}; do
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$t" || true)"
    if [[ "$code" == 200 ]]; then echo "preflight: ok: $t 200"; else bad "$t answers $code after the change"; fi
  done
  remote "docker exec '$NGINX' nginx -t >/dev/null 2>&1" || bad "nginx -t fails in $NGINX"

  if [[ "$fail" == 0 ]]; then
    echo "preflight: ok: $EDGE_NETWORK is ready (kept, with $NGINX connected)"
    return 0
  fi
  if [[ "$connected" == 1 ]]; then remote "docker network disconnect '$EDGE_NETWORK' '$NGINX'" || echo "preflight: could not disconnect $NGINX from $EDGE_NETWORK" >&2; fi
  if [[ "$created" == 1 ]]; then remote "docker network rm '$EDGE_NETWORK' >/dev/null" || echo "preflight: could not remove $EDGE_NETWORK" >&2; fi
  echo "preflight: FAILED; undone what this run added (connected=$connected created=$created)" >&2
  return 1
}

status() {
  local l c i
  l="$(live)"
  echo "live: $l ($(state current)); previous: $(state previous)"
  for c in pitlane-blue pitlane-green; do
    read -r -a i <<<"$(info "$c")"
    [[ -n "${i[0]:-}" ]] || continue
    if [[ "${i[0]}" == true ]]; then
      echo "$c: running ${i[1]} restart=${i[2]} sockets=$(conns "$c")"
    else
      echo "$c: running=${i[0]} ${i[1]}"
    fi
  done
}

# cleanup: remove pitlane:<version> images (and their compose files) that
# neither color runs. Containers are never removed here.
cleanup() {
  local keep tag
  keep=" $(state version-blue) $(state version-green) "
  for tag in $(remote "docker images pitlane --filter dangling=false --format '{{.Tag}}'"); do
    isversion "$tag" || continue
    case "$keep" in
      *" $tag "*) ;;
      *) remote "docker rmi 'pitlane:$tag' >/dev/null 2>&1 && rm -f '$DIR/compose-$tag.yml'" || true ;;
    esac
  done
}

case "${1:-}" in
  --status)
    status
    exit 0
    ;;
  --preflight-network)
    shift
    lock_box
    preflight_network "$@"
    exit $?
    ;;
  --doctor)
    doctor
    exit $?
    ;;
  --rollback)
    v="${2:-}"; [[ -n "$v" ]] || die "usage: $0 --rollback <version>"
    valid "$v"
    remote "docker image inspect 'pitlane:$v' >/dev/null" || die "image pitlane:$v not on $HOST"
    lock_box
    edge_network
    promote "$v"
    echo "deploy: rolled back to $v"
    status
    doctor || die "rolled back, but the doctor found problems (above)"
    exit 0
    ;;
  "") ;;
  *) die "usage: $0 [--rollback <version> | --status | --doctor | --preflight-network [host:port | https://url ...]]" ;;
esac

[[ -f dist/pitlane-linux-arm64 && -f dist/VERSION ]] || die "no dist/; run scripts/release.sh first"
VERSION="$(cat dist/VERSION)"
valid "$VERSION"
[[ "$VERSION" != *-dirty ]] || die "refusing a dirty build ($VERSION)"
static_arm64 dist/pitlane-linux-arm64 || die "dist binary is not a static linux/arm64 ELF"
lock_box
live >/dev/null || exit 1
remote "docker inspect '$NGINX' >/dev/null" || die "no nginx container $NGINX on $HOST"
idle_running "$VERSION" || true # refuses before shipping while the idle color drains another version
edge_network
edge_subnet >/dev/null || exit 1 # fail before shipping anything

remote "mkdir -p '$DIR/dist'"
ship dist/pitlane-linux-arm64 "$DIR/dist/pitlane-linux-arm64"
ship Dockerfile.runtime "$DIR/Dockerfile.runtime"
ship deploy/compose.yml "$DIR/compose-$VERSION.yml"
ship deploy/switch-upstream.sh "$DIR/switch-upstream.sh"
remote "chmod 0755 '$DIR/switch-upstream.sh'"
remote "cd '$DIR' && docker build -q -f Dockerfile.runtime -t 'pitlane:$VERSION' ." >/dev/null

promote "$VERSION"
cleanup
echo "deploy: pitlane $VERSION is live (rollback: $0 --rollback $(state previous))"
status
doctor || die "deployed, but the doctor found problems (above)"
