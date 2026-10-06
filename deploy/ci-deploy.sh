#!/usr/bin/env bash
# The only command the CI deploy key may run on the server (authorized_keys:
#   command="<DIR>/ci/ci-deploy.sh",restrict ssh-ed25519 ... pitlane-ci
# ). It reads one release bundle (tar on stdin: dist/pitlane-linux-arm64,
# dist/VERSION, Dockerfile.runtime, deploy/compose.yml,
# deploy/switch-upstream.sh, scripts/deploy.sh and nothing else), unpacks it
# into a fresh directory and runs that deploy.sh on this machine with the
# server-side settings in <DIR>/ci/deploy.env (DEPLOY_HOST=local). Whatever
# the client asked to run (SSH_ORIGINAL_COMMAND) is ignored: this script
# only ever deploys. The settings never leave the server.
set -euo pipefail

CI_DIR="$(cd "$(dirname "$0")" && pwd)"
MAX_BYTES=$((96 * 1024 * 1024))
WANT='Dockerfile.runtime
deploy/compose.yml
deploy/switch-upstream.sh
dist/VERSION
dist/pitlane-linux-arm64
scripts/deploy.sh'

die() { echo "ci-deploy: $*" >&2; exit 1; }

work="$(mktemp -d "$CI_DIR/run.XXXXXX")"
cleanup() {
  local f
  while IFS= read -r f; do rm -f -- "$work/$f"; done <<<"$WANT"
  rm -f -- "$work/bundle.tar"
  rmdir -- "$work/dist" "$work/deploy" "$work/scripts" "$work" 2>/dev/null || true
}
trap cleanup EXIT

head -c "$((MAX_BYTES + 1))" >"$work/bundle.tar"
[[ "$(stat -c %s "$work/bundle.tar")" -le "$MAX_BYTES" ]] || die "bundle larger than $MAX_BYTES bytes"

# Exactly the expected regular files: no links, devices, absolute or ../ paths.
list="$(tar -tvf "$work/bundle.tar")" || die "not a tar archive"
while IFS= read -r line; do
  [[ "${line:0:1}" == "-" ]] || die "bundle holds something other than a regular file: $line"
done <<<"$list"
[[ "$(tar -tf "$work/bundle.tar" | LC_ALL=C sort)" == "$WANT" ]] || die "bundle does not hold exactly the expected files"

tar -xf "$work/bundle.tar" -C "$work" --no-same-owner --no-same-permissions
v="$(cat "$work/dist/VERSION")"
[[ "$v" =~ ^[A-Za-z0-9._-]+$ ]] || die "bad version in the bundle"

echo "ci-deploy: deploying $v"
cd "$work"
# A CI deploy waits for a still-draining idle color (its players finish)
# rather than failing; DRAIN_MAX in deploy.env bounds that drain anyway.
DRAIN_WAIT=2100 DEPLOY_ENV="$CI_DIR/deploy.env" bash scripts/deploy.sh
