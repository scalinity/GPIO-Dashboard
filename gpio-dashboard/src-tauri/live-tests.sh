#!/bin/bash
# Runs the ignored integration tests (src/live_tests.rs) against throwaway OpenSSH
# servers on 127.0.0.1: port 2222 normally, port 2223 with PTY requests refused.
# Needs /usr/sbin/sshd and ssh-keygen. Extra arguments go to `cargo test`.
set -u
cd "$(dirname "$0")"
DIR=$(mktemp -d)
PIDS=""
trap 'kill $PIDS 2>/dev/null; rm -rf "$DIR"' EXIT

ssh-keygen -q -t ed25519 -N "" -f "$DIR/host"
ssh-keygen -q -t ed25519 -N "" -f "$DIR/k_ed25519"
ssh-keygen -q -t ed25519 -N "s3cret-pass" -f "$DIR/k_ed25519_pass"
ssh-keygen -q -t rsa -b 3072 -N "" -f "$DIR/k_rsa"
ssh-keygen -q -t ecdsa -b 256 -N "" -f "$DIR/k_ecdsa"
ssh-keygen -q -t ed25519 -N "" -f "$DIR/k_unauthorized"
cat "$DIR"/k_ed25519.pub "$DIR"/k_ed25519_pass.pub "$DIR"/k_rsa.pub "$DIR"/k_ecdsa.pub > "$DIR/authorized_keys"

start_sshd() { # port permit_tty
  cat > "$DIR/sshd_$1" <<CONFIG
Port $1
ListenAddress 127.0.0.1
HostKey $DIR/host
AuthorizedKeysFile $DIR/authorized_keys
PidFile $DIR/sshd_$1.pid
UsePAM no
PasswordAuthentication no
KbdInteractiveAuthentication no
StrictModes no
PermitTTY $2
CONFIG
  /usr/sbin/sshd -D -e -f "$DIR/sshd_$1" > "$DIR/sshd_$1.log" 2>&1 &
  PIDS="$PIDS $!"
  for _ in $(seq 1 30); do nc -z 127.0.0.1 "$1" 2>/dev/null && return; sleep 0.2; done
  echo "sshd on port $1 did not start:"; cat "$DIR/sshd_$1.log"; exit 1
}
start_sshd 2222 yes
start_sshd 2223 no

SSHD_TEST_DIR="$DIR" cargo test -- --ignored --test-threads=1 "$@"
