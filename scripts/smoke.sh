#!/usr/bin/env bash
# Headless end-to-end smoke test: build the server and the load generator,
# start the server on a free loopback port with raised per-address limits,
# drive it with cmd/loadtest (bots doing the real WebSocket handshake), and
# fail unless every player stayed connected and no snapshot was skipped.
#   scripts/smoke.sh            # 4 players, 10 s
#   PLAYERS=8 DURATION=30s scripts/smoke.sh
#   SERVER_ARGS="-lag 100ms" scripts/smoke.sh   # with artificial latency
# Needs only go and curl. Kills only the server it started.
set -euo pipefail
cd "$(dirname "$0")/.."

PLAYERS="${PLAYERS:-4}"
DURATION="${DURATION:-10s}"
read -r -a extra <<<"${SERVER_ARGS:-}"

work="$(mktemp -d "${TMPDIR:-/tmp}/pitlane-smoke.XXXXXX")"
pid=""
cleanup() {
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -f "$work/pitlane" "$work/loadtest" "$work/server.log" "$work/loadtest.log"
  rmdir "$work" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

echo "smoke: build"
go build -o "$work/pitlane" ./cmd/pitlane
go build -o "$work/loadtest" ./cmd/loadtest

# Pick a free port: one nothing answers on, and that our server then binds.
port=""
for _ in 1 2 3 4 5; do
  p=$((20000 + RANDOM % 20000))
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$p/healthz"; then
    continue # something already listens there
  fi
  "$work/pitlane" -addr "127.0.0.1:$p" \
    -max-conns 1000 -max-conns-ip 1000 -max-conns-net 1000 \
    -create-per-min-ip 1000 -join-per-min-ip 1000 -join-fail-per-min-ip 1000 \
    -max-rooms 64 ${extra[@]+"${extra[@]}"} >"$work/server.log" 2>&1 &
  pid=$!
  for _ in $(seq 1 50); do
    if ! kill -0 "$pid" 2>/dev/null; then
      break # exited: port taken or bad flags
    fi
    if curl -fs -o /dev/null --max-time 1 "http://127.0.0.1:$p/healthz"; then
      port="$p"
      break
    fi
    sleep 0.1
  done
  [[ -n "$port" ]] && break
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  pid=""
done
if [[ -z "$port" ]]; then
  echo "smoke: FAIL: server did not become healthy" >&2
  cat "$work/server.log" >&2 2>/dev/null || true
  exit 1
fi
echo "smoke: server pid $pid on 127.0.0.1:$port"

echo "smoke: loadtest players=$PLAYERS duration=$DURATION"
if ! "$work/loadtest" -url "ws://127.0.0.1:$port/ws" -players "$PLAYERS" -rooms 1 \
  -ramp 2s -settle 2s -duration "$DURATION" | tee "$work/loadtest.log"; then
  echo "smoke: FAIL: loadtest exited with an error" >&2
  exit 1
fi

fail=""
grep -q '^disconnects: none$' "$work/loadtest.log" || fail="disconnects"
grep -Eq '^snap interval: .* gaps=0$' "$work/loadtest.log" || fail="${fail:+$fail, }snapshot gaps"
grep -Eq '^steady window .* conns='"$PLAYERS"' ' "$work/loadtest.log" || fail="${fail:+$fail, }connections"
if ! kill -0 "$pid" 2>/dev/null; then
  fail="${fail:+$fail, }server exited"
fi
if [[ -n "$fail" ]]; then
  echo "smoke: FAIL: $fail" >&2
  echo "--- server log (tail)" >&2
  tail -n 40 "$work/server.log" >&2 || true
  exit 1
fi
echo "smoke: PASS players=$PLAYERS duration=$DURATION port=$port"
