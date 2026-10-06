#!/usr/bin/env bash
# Point the nginx container's pitlane vhost at another container, without dropping
# the WebSockets it already proxies (nginx -s reload: old workers keep their
# connections until they close).
#   switch-upstream.sh <vhost conf on the host> <nginx container> <target>
# target: pitlane-blue | pitlane-green.
# Run on the server by scripts/deploy.sh (shipped next to it as
# $DEPLOY_DIR/switch-upstream.sh), or by hand (runbook).
#
# Lock: it holds flock on deploy.lock next to it for the whole run, the lock
# scripts/deploy.sh holds for a whole deploy; deploy.sh, already holding it,
# sets PITLANE_DEPLOY_LOCK_HELD=1. A concurrent run fails at once.
#
# The conf is a single-file bind mount: it is rewritten IN PLACE
# (`cat tmp > conf`, same inode); sed -i or mv would replace the inode and
# the container would keep reading the old file. Exactly one line
#   set $pitlane_upstream http://<name>:8080;
# must exist. nginx -t must pass, and nginx -T must show the new line (the
# container sees the rewrite), before the reload. From the first write until
# the reload succeeded, any failure, error or signal writes the backup back
# byte for byte (same inode) and checks it with nginx -t; the exit status is
# non-zero. The backup of each run is kept (<conf name>.bak.<time>.<pid>,
# the last 10).
set -euo pipefail

die() { echo "switch-upstream: $*" >&2; exit 1; }

[[ $# -eq 3 ]] || die "usage: $0 <conf> <nginx-container> <target>"
conf="$1" nginx="$2" target="$3"
[[ "$target" =~ ^pitlane-(blue|green)$ ]] || die "bad target '$target'"
[[ "$nginx" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "bad nginx container '$nginx'"
[[ -f "$conf" && -w "$conf" ]] || die "$conf is not a writable file"
dir="$(cd "$(dirname "$0")" && pwd)"

if [[ "${PITLANE_DEPLOY_LOCK_HELD:-}" != 1 ]]; then
  exec 9>"$dir/deploy.lock"
  flock -n 9 || die "another deploy or switch is running ($dir/deploy.lock); nothing changed"
fi

line='^[[:space:]]*set[[:space:]]+\$pitlane_upstream[[:space:]]+http://pitlane-(blue|green):8080;'
want="set[[:space:]]+\\\$pitlane_upstream[[:space:]]+http://$target:8080;"
n="$(grep -cE "$line" "$conf" || true)"
[[ "$n" == 1 ]] || die "expected exactly one 'set \$pitlane_upstream http://pitlane-<color>:8080;' line in $conf, found $n"
if grep -qE "^[[:space:]]*$want" "$conf"; then
  echo "switch-upstream: already $target"
  exit 0
fi

stamp="$(date +%Y%m%dT%H%M%S).$$"
base="$(basename "$conf")"
bak="$dir/$base.bak.$stamp" new="$dir/$base.new.$stamp"
cp -p "$conf" "$bak"
ls -1t "$dir/$base".bak.* 2>/dev/null | tail -n +11 | while read -r old; do rm -f "$old"; done
sed -E "s#^([[:space:]]*set[[:space:]]+\\\$pitlane_upstream[[:space:]]+http://)pitlane-(blue|green)(:8080;)#\\1$target\\3#" "$bak" > "$new"
changed="$(diff "$bak" "$new" | grep -c '^[<>]' || true)"
[[ "$changed" == 2 ]] || { rm -f "$new"; die "rewrite changed $changed diff lines, expected 2 (one out, one in); $conf untouched"; }

inode() { ls -i "$1" | awk '{print $1}'; }
before="$(inode "$conf")"

# restore writes the backup back in place and checks it; armed from the
# first write until the reload succeeded.
restore() {
  trap - ERR INT TERM HUP
  set +e
  cat "$bak" > "$conf"
  if cmp -s "$bak" "$conf" && [[ "$(inode "$conf")" == "$before" ]]; then
    echo "switch-upstream: restored $conf from $bak" >&2
  else
    echo "switch-upstream: !!! RESTORE FAILED: $conf may be broken for EVERY vhost; backup at $bak (write it back in place: cat $bak > $conf)" >&2
  fi
  if docker exec "$nginx" nginx -t >/dev/null 2>&1; then
    echo "switch-upstream: nginx -t passes on the restored file (running nginx unchanged)" >&2
  else
    echo "switch-upstream: !!! nginx -t FAILS on $conf; do not reload or restart $nginx until it is fixed" >&2
  fi
  rm -f "$new"
}
fail() { restore; die "$*"; }
trap 'fail "interrupted or a command failed; restored"' ERR INT TERM HUP

cat "$new" > "$conf" # in place: the bind mount keeps pointing at this inode
cmp -s "$new" "$conf" || fail "write incomplete; restored"
[[ "$(inode "$conf")" == "$before" ]] || fail "inode changed; restored"

docker exec "$nginx" nginx -t || fail "nginx -t failed; restored, nothing reloaded"
# Read the whole dump before matching (a grep -q in a pipe would close it
# early and fail on SIGPIPE once all vhosts exceed the pipe buffer).
dump="$(docker exec "$nginx" nginx -T 2>/dev/null)" || fail "nginx -T failed; restored, nothing reloaded"
grep -qE "$want" <<<"$dump" || fail "nginx does not see the rewrite (bind mount?); restored, nothing reloaded"
if ! docker exec "$nginx" nginx -s reload; then
  restore
  docker exec "$nginx" nginx -s reload || true # back to the restored file
  die "nginx reload failed; restored"
fi
trap - ERR INT TERM HUP
rm -f "$new"
echo "switch-upstream: $target"
