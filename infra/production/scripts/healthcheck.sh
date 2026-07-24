#!/usr/bin/env bash
set -euo pipefail

origin="${WORKLENZ_ORIGIN:-https://projects.myfusionadmin.com}"
attempts="${HEALTHCHECK_ATTEMPTS:-24}"

if [[ -f compose.yml && -f .env && -f .release.env ]]; then
  compose=(docker compose --env-file .env --env-file .release.env -f compose.yml)
  clamav_container="$("${compose[@]}" ps -q clamav)"
  if [[ -z "$clamav_container" ]]; then
    echo "ClamAV health check failed: container is not running." >&2
    exit 1
  fi
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$clamav_container")" != "healthy" ]]; then
    echo "ClamAV health check failed: scanner is not healthy." >&2
    exit 1
  fi
fi

for ((i=1; i<=attempts; i++)); do
  if curl --fail --silent --show-error --max-time 10 "${origin}/public/health" | grep -q '"status":"ok"'; then
    echo "Worklenz health check passed."
    exit 0
  fi
  sleep 5
done

echo "Worklenz health check failed after ${attempts} attempts." >&2
exit 1
