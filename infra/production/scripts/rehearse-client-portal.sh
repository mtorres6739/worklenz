#!/usr/bin/env bash
set -euo pipefail

deploy_dir="${WORKLENZ_DEPLOY_DIR:-/srv/worklenz}"
cd "$deploy_dir"
set -a
# shellcheck disable=SC1091
source .env
source .release.env
set +a

: "${BACKUP_AGE_IDENTITY_FILE:?Missing BACKUP_AGE_IDENTITY_FILE}"
: "${BACKEND_IMAGE:?Missing immutable BACKEND_IMAGE}"
: "${DATABASE_IMAGE:?Missing immutable DATABASE_IMAGE}"
: "${CLAMAV_IMAGE:?Missing immutable CLAMAV_IMAGE}"

script_file="${CLIENT_PORTAL_ISOLATION_SCRIPT:-$deploy_dir/scripts/client-portal-isolation.js}"
[[ -f "$script_file" ]] || { echo "Missing $script_file" >&2; exit 1; }

tmp_dir="$(mktemp -d)"
suffix="$(date +%s)-$$"
database_container="worklenz-client-portal-db-${suffix}"
backend_container="worklenz-client-portal-backend-${suffix}"
clamav_container="worklenz-client-portal-clamav-${suffix}"
tester_container="worklenz-client-portal-tester-${suffix}"
network_name="worklenz-client-portal-${suffix}"
test_origin="https://client-portal-isolation.invalid"

cleanup() {
  docker rm -f "$tester_container" "$backend_container" "$clamav_container" \
    "$database_container" >/dev/null 2>&1 || true
  docker network rm "$network_name" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$BACKUP_S3_REGION"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

key="$(aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3api list-objects-v2 \
  --bucket "$BACKUP_S3_BUCKET" --prefix postgres/daily/ \
  --query 'sort_by(Contents[?ends_with(Key, `.dump.age`)],&LastModified)[-1].Key' --output text)"
[[ "$key" != "None" ]] || { echo "No encrypted backup is available for Client Portal rehearsal" >&2; exit 1; }

aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp \
  "s3://${BACKUP_S3_BUCKET}/${key}" "$tmp_dir/backup.age" --only-show-errors
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp \
  "s3://${BACKUP_S3_BUCKET}/${key}.sha256" "$tmp_dir/backup.age.sha256" --only-show-errors
expected_checksum="$(awk 'NR == 1 { print $1 }' "$tmp_dir/backup.age.sha256")"
actual_checksum="$(sha256sum "$tmp_dir/backup.age" | awk '{ print $1 }')"
[[ "$actual_checksum" == "$expected_checksum" ]] || { echo "Encrypted backup checksum mismatch" >&2; exit 1; }

age -d -i "$BACKUP_AGE_IDENTITY_FILE" -o "$tmp_dir/backup.dump" "$tmp_dir/backup.age"
pg_restore --list "$tmp_dir/backup.dump" >/dev/null

# The disposable network publishes no ports. It deliberately permits egress so
# the isolated backend can exercise the real private object-storage path and the
# scanner can refresh its definitions.
docker network create "$network_name" >/dev/null
docker run -d --name "$database_container" --network "$network_name" --network-alias portal-db --user postgres \
  -e POSTGRES_USER=isolation -e POSTGRES_PASSWORD=isolation -e POSTGRES_DB=isolation \
  "$DATABASE_IMAGE" >/dev/null

for _ in {1..30}; do
  docker exec "$database_container" pg_isready -U isolation -d isolation >/dev/null 2>&1 && break
  sleep 2
done
# The custom database image initializes in a temporary server before restarting.
sleep 5
for _ in {1..30}; do
  if docker exec "$database_container" psql -U isolation -d isolation -Atc "SELECT 1" 2>/dev/null | grep -qx 1; then
    break
  fi
  sleep 2
done
docker exec "$database_container" psql -U isolation -d isolation -Atc "SELECT 1" | grep -qx 1
# The database image initializes the base schema. Restore into a fresh empty
# database so a newer backup can replace that schema without dependency-order
# failures from pg_restore --clean.
docker exec "$database_container" dropdb -U isolation --force isolation
docker exec "$database_container" createdb -U isolation isolation
docker exec -i "$database_container" pg_restore -U isolation -d isolation \
  --no-owner --no-privileges < "$tmp_dir/backup.dump"

# Rehearse the candidate image's complete controlled migration chain before the
# application starts. This keeps the fixture aligned with the exact release that
# will be promoted and catches missing additive schema in the restored backup.
docker run --rm --network "$network_name" \
  -e DB_USER=isolation -e DB_PASSWORD=isolation -e DB_HOST=portal-db \
  -e DB_PORT=5432 -e DB_NAME=isolation \
  "$BACKEND_IMAGE" node scripts/migrate.js up
docker exec "$database_container" psql -U isolation -d isolation -Atc \
  "SELECT to_regclass('public.project_files') IS NOT NULL" | grep -qx t

docker run -d --name "$clamav_container" --network "$network_name" \
  --network-alias portal-clamav --security-opt no-new-privileges:true \
  --pids-limit 256 -e CLAMAV_NO_CLAMD=false -e CLAMAV_NO_FRESHCLAMD=false \
  -e FRESHCLAM_CHECKS=12 "$CLAMAV_IMAGE" >/dev/null
for _ in {1..90}; do
  if docker exec "$clamav_container" \
    clamdscan --ping=1 --wait /etc/hostname >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker exec "$clamav_container" \
  clamdscan --ping=1 --wait /etc/hostname >/dev/null

docker run -d --name "$backend_container" --network "$network_name" --network-alias portal-backend \
  --env-file .env \
  -e DB_USER=isolation -e DB_PASSWORD=isolation -e DB_HOST=portal-db -e DB_PORT=5432 -e DB_NAME=isolation \
  -e PORT=3000 -e APP_ORIGIN="$test_origin" -e SOCKET_IO_CORS="$test_origin" \
  -e FEATURE_CLIENT_PORTAL=true -e FEATURE_CLIENT_PORTAL_SERVICES=true \
  -e FEATURE_CLIENT_PORTAL_REQUESTS=true \
  -e FEATURE_CLIENT_PORTAL_REQUEST_NOTIFICATIONS=true \
  -e IMPORT_WORKER_ENABLED=false \
  -e PORTAL_ATTACHMENT_SCAN_MODE=clamav -e CLAMAV_HOST=portal-clamav \
  -e CLAMAV_PORT=3310 -e CLAMAV_SCAN_TIMEOUT_MS=30000 \
  -e ENABLE_EMAIL_CRONJOBS=false -e ENABLE_RECURRING_JOBS=false \
  "$BACKEND_IMAGE" >/dev/null

for _ in {1..45}; do
  if docker run --rm --network "$network_name" "$BACKEND_IMAGE" node -e \
    "fetch('http://portal-backend:3000/public/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker run --rm --network "$network_name" "$BACKEND_IMAGE" node -e \
  "fetch('http://portal-backend:3000/public/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

docker run --name "$tester_container" --network "$network_name" \
  --env-file .env \
  -e DB_USER=isolation -e DB_PASSWORD=isolation -e DB_HOST=portal-db -e DB_PORT=5432 -e DB_NAME=isolation \
  -e APP_ORIGIN="$test_origin" -e ISOLATION_BASE_URL=http://portal-backend:3000 \
  -v "$script_file:/app/client-portal-isolation.js:ro" \
  "$BACKEND_IMAGE" node /app/client-portal-isolation.js
