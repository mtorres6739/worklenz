#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" || "$1" != *.js ]]; then
  echo "Usage: $0 <node-pg-migrate-js-file>" >&2
  exit 64
fi

migration_file="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
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

tmp_dir="$(mktemp -d)"
migration_dir="$tmp_dir/migrations"
suffix="$(date +%s)-$$"
container_name="worklenz-migration-rehearsal-${suffix}"
network_name="worklenz-migration-rehearsal-${suffix}"
cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  docker network rm "$network_name" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

install -d -m 0755 "$migration_dir"
install -m 0644 "$migration_file" "$migration_dir/$(basename "$migration_file")"

export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$BACKUP_S3_REGION"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

key="$(aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3api list-objects-v2 \
  --bucket "$BACKUP_S3_BUCKET" --prefix postgres/daily/ \
  --query 'sort_by(Contents[?ends_with(Key, `.dump.age`)],&LastModified)[-1].Key' --output text)"
[[ "$key" != "None" ]] || { echo "No encrypted backup is available for migration rehearsal" >&2; exit 1; }

aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp \
  "s3://${BACKUP_S3_BUCKET}/${key}" "$tmp_dir/backup.age" --only-show-errors
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp \
  "s3://${BACKUP_S3_BUCKET}/${key}.sha256" "$tmp_dir/backup.age.sha256" --only-show-errors
expected_checksum="$(awk 'NR == 1 { print $1 }' "$tmp_dir/backup.age.sha256")"
actual_checksum="$(sha256sum "$tmp_dir/backup.age" | awk '{ print $1 }')"
[[ "$actual_checksum" == "$expected_checksum" ]] || { echo "Encrypted backup checksum mismatch" >&2; exit 1; }

age -d -i "$BACKUP_AGE_IDENTITY_FILE" -o "$tmp_dir/backup.dump" "$tmp_dir/backup.age"
pg_restore --list "$tmp_dir/backup.dump" >/dev/null

docker network create --internal "$network_name" >/dev/null
docker run -d --name "$container_name" --network "$network_name" --user postgres \
  -e POSTGRES_USER=rehearsal -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=rehearsal \
  "$DATABASE_IMAGE" >/dev/null
for _ in {1..30}; do
  docker exec "$container_name" pg_isready -U rehearsal -d rehearsal >/dev/null 2>&1 && break
  sleep 2
done
# The production database image initializes the Worklenz schema in a temporary PostgreSQL
# process and then restarts into its final server. Do not mistake that temporary process for the
# stable restore target.
sleep 5
for _ in {1..30}; do
  if docker exec "$container_name" psql -U rehearsal -d rehearsal -Atc "SELECT 1" 2>/dev/null \
    | grep -qx 1; then
    break
  fi
  sleep 2
done
docker exec "$container_name" psql -U rehearsal -d rehearsal -Atc "SELECT 1" | grep -qx 1
docker exec -i "$container_name" pg_restore -U rehearsal -d rehearsal \
  --clean --if-exists --no-owner --no-privileges < "$tmp_dir/backup.dump"

run_migration() {
  docker run --rm --network "$network_name" \
    -v "$migration_dir:/rehearsal:ro" \
    -e DB_USER=rehearsal -e DB_PASSWORD=rehearsal -e DB_HOST="$container_name" \
    -e DB_PORT=5432 -e DB_NAME=rehearsal -e WORKLENZ_MIGRATIONS_DIR=/rehearsal \
    "$BACKEND_IMAGE" node scripts/migrate.js \
    --migrations-table self_hosted_migration_rehearsal up
}

run_migration
run_migration

case "$(basename "$migration_file")" in
2026072100100_wave3_identity_branding_slack.js)
  docker exec "$container_name" psql -U rehearsal -d rehearsal -v ON_ERROR_STOP=1 -Atc \
    "SELECT to_regclass('public.organization_branding') IS NOT NULL
         AND to_regclass('public.oidc_providers') IS NOT NULL
         AND to_regclass('public.oidc_identities') IS NOT NULL
         AND to_regclass('public.integration_audit_log') IS NOT NULL
         AND to_regclass('public.slack_workspaces') IS NOT NULL
         AND to_regclass('public.slack_request_receipts') IS NOT NULL;" | grep -qx t
  ;;
2026072100000_self-hosted-finance.js)
  docker exec "$container_name" psql -U rehearsal -d rehearsal -v ON_ERROR_STOP=1 -Atc \
    "SELECT to_regclass('public.finance_rate_cards') IS NOT NULL
         AND to_regclass('public.project_rate_card_roles') IS NOT NULL
         AND to_regclass('public.finance_work_log_rate_snapshots') IS NOT NULL;" | grep -qx t
  docker exec "$container_name" psql -U rehearsal -d rehearsal -v ON_ERROR_STOP=1 -Atc \
    "SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'calculation_method'
     ) AND EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'project_members' AND column_name = 'project_rate_card_role_id'
     );" | grep -qx t
  ;;
esac

echo "Migration rehearsal passed twice against an isolated encrypted-backup restore clone."
