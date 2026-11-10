#!/usr/bin/env bash
# Entry point for automatic deploys from GitHub Actions (.github/workflows/deploy.yml).
#
# It is the *forced command* of the deploy SSH key in ~/.ssh/authorized_keys, so that key can run
# nothing else (whatever command the client sends is ignored). It:
#   1. refuses if this checkout is not on `main` or has uncommitted changes to tracked files,
#   2. fast-forwards to origin/main (never merges, never resets),
#   3. runs deploy/redeploy.sh unless that exact commit is already deployed.
#
# The deploy runs detached from the SSH session, so a dropped connection can't kill it halfway
# (redeploy.sh stops the web service during the build). Its log is streamed back to the caller,
# and the script exits with the deploy's status. Logs: ~/.local/state/todoer-deploy/.
set -euo pipefail

STATE_DIR="$HOME/.local/state/todoer-deploy"
GENERATED=apps/web/next-env.d.ts   # rewritten by every `next dev`/`next build`; not real changes

run_deploy() {
  local repo=$1 status_file=$2
  cd "$repo"
  # One deploy at a time; a second push waits for the first.
  exec 9>"$STATE_DIR/lock"
  if ! flock -w 1800 9; then
    echo "Another deploy has held the lock for 30 minutes; giving up." >&2
    return 1
  fi

  echo "== $(date -u +%FT%TZ) deploy requested for ${REQUESTED_SHA:-unknown}"
  local branch
  branch=$(git symbolic-ref --short -q HEAD || echo "(detached)")
  if [[ $branch != main ]]; then
    echo "Production checkout is on '$branch', not 'main'. Refusing to deploy." >&2
    return 1
  fi
  git checkout -- "$GENERATED" 2>/dev/null || true
  if [[ -n $(git status --porcelain --untracked-files=no) ]]; then
    echo "Production checkout has uncommitted changes. Refusing to deploy:" >&2
    git status --short --untracked-files=no >&2
    return 1
  fi

  git fetch --quiet origin main
  if ! git merge --ff-only --quiet origin/main; then
    echo "Local main has diverged from origin/main (unpushed commits?). Refusing to deploy." >&2
    git log --oneline --left-right HEAD...origin/main >&2 || true
    return 1
  fi

  local head deployed=""
  head=$(git rev-parse HEAD)
  [[ -f $STATE_DIR/deployed-sha ]] && deployed=$(<"$STATE_DIR/deployed-sha")
  echo "== HEAD is now $(git log -1 --format='%h %s')"
  if [[ $head == "$deployed" ]]; then
    echo "== $head is already deployed; nothing to do."
    return 0
  fi

  # run_deploy is called in an OR-list, so errexit is disabled inside this function.
  # Propagate failure explicitly; never mark a failed build as deployed.
  deploy/redeploy.sh || return $?
  echo "$head" >"$STATE_DIR/deployed-sha"
  echo "== $(date -u +%FT%TZ) deployed $head"
}

main() {
  local repo
  repo=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
  mkdir -p "$STATE_DIR"

  if [[ ${1:-} == --run ]]; then
    local status_file=$2 rc=0
    run_deploy "$repo" "$status_file" || rc=$?
    echo "$rc" >"$status_file"
    return "$rc"
  fi

  # The client's requested command (the pushed commit SHA) is informational only.
  export REQUESTED_SHA=${SSH_ORIGINAL_COMMAND:-${1:-}}
  REQUESTED_SHA=${REQUESTED_SHA//[^0-9a-f]/}

  local stamp log status_file
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  log="$STATE_DIR/deploy-$stamp.log"
  status_file="$STATE_DIR/deploy-$stamp.status"
  : >"$log"
  setsid nohup "$repo/deploy/ci-deploy.sh" --run "$status_file" >"$log" 2>&1 </dev/null &

  tail -n +1 -f "$log" &
  local tail_pid=$!
  while [[ ! -s $status_file ]]; do sleep 2; done
  sleep 1
  kill "$tail_pid" 2>/dev/null || true

  # Keep the 30 most recent logs.
  ls -1t "$STATE_DIR"/deploy-*.log 2>/dev/null | tail -n +31 | while read -r old; do
    rm -f "$old" "${old%.log}.status"
  done

  exit "$(<"$status_file")"
}

main "$@"
