#!/usr/bin/env bash
set -euo pipefail

origin="${WORKLENZ_ORIGIN:-https://projects.myfusionadmin.com}"
attempts="${HEALTHCHECK_ATTEMPTS:-24}"

for ((i=1; i<=attempts; i++)); do
  if curl --fail --silent --show-error --max-time 10 "${origin}/public/health" | grep -q '"status":"ok"'; then
    echo "Worklenz health check passed."
    exit 0
  fi
  sleep 5
done

echo "Worklenz health check failed after ${attempts} attempts." >&2
exit 1
