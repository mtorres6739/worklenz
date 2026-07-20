#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: $0 <full-git-commit-sha>" >&2
  exit 64
fi

release_sha="$1"
deploy_dir="${WORKLENZ_DEPLOY_DIR:-/srv/worklenz}"
cd "$deploy_dir"

# Release image tags always come from the generated release file. Prevent a caller's
# exported variables from silently overriding the requested commit SHA in Compose.
unset BACKEND_IMAGE FRONTEND_IMAGE DATABASE_IMAGE GATEWAY_IMAGE RELEASE_SHA

for required in .env compose.yml tls/origin.pem tls/origin-key.pem; do
  [[ -f "$required" ]] || { echo "Missing $deploy_dir/$required" >&2; exit 1; }
done

umask 077
if [[ -f .release.env ]]; then
  cp .release.env .release.previous.env
fi

cat > .release.env <<EOF
BACKEND_IMAGE=ghcr.io/mtorres6739/worklenz-backend:${release_sha}
FRONTEND_IMAGE=ghcr.io/mtorres6739/worklenz-frontend:${release_sha}
DATABASE_IMAGE=ghcr.io/mtorres6739/worklenz-database:${release_sha}
GATEWAY_IMAGE=ghcr.io/mtorres6739/worklenz-gateway:${release_sha}
REDIS_IMAGE=${REDIS_IMAGE:?Set REDIS_IMAGE to a digest-pinned redis image}
RELEASE_SHA=${release_sha}
EOF

compose=(docker compose --env-file .env --env-file .release.env -f compose.yml)

restore_previous_release() {
  if [[ ! -f .release.previous.env ]]; then
    echo "No previous release is available for rollback." >&2
    return 1
  fi

  cp .release.previous.env .release.env
  docker compose --env-file .env --env-file .release.env -f compose.yml \
    up -d backend frontend gateway
  echo "Previous application images restored. Review migration compatibility before retrying." >&2
}

if "${compose[@]}" ps --status running postgres | grep -q postgres; then
  ./scripts/backup.sh pre-deploy
fi

"${compose[@]}" pull
"${compose[@]}" up -d postgres redis
"${compose[@]}" --profile migration run --rm migrate
if ! "${compose[@]}" up -d --remove-orphans backend frontend gateway; then
  echo "Release containers failed to start." >&2
  restore_previous_release || true
  exit 1
fi

if ! ./scripts/healthcheck.sh; then
  echo "Release health check failed." >&2
  restore_previous_release || true
  exit 1
fi

echo "Deployed ${release_sha}."
