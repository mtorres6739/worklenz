#!/usr/bin/env bash
set -euo pipefail

backup_class="${1:-daily}"
deploy_dir="${WORKLENZ_DEPLOY_DIR:-/srv/worklenz}"
cd "$deploy_dir"

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${BACKUP_AGE_RECIPIENT:?Missing BACKUP_AGE_RECIPIENT}"
: "${BACKUP_S3_BUCKET:?Missing BACKUP_S3_BUCKET}"
: "${BACKUP_S3_ENDPOINT:?Missing BACKUP_S3_ENDPOINT}"
: "${BACKUP_S3_REGION:?Missing BACKUP_S3_REGION}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
prefix="daily"
[[ "$backup_class" == "pre-deploy" ]] && prefix="pre-deploy"
[[ "$(date -u +%d)" == "01" && "$backup_class" == "daily" ]] && prefix="monthly"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
dump_file="$tmp_dir/worklenz-${timestamp}.dump"
encrypted_file="${dump_file}.age"

docker compose --env-file .env --env-file .release.env -f compose.yml \
  exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$dump_file"

pg_restore --list "$dump_file" >/dev/null
age -r "$BACKUP_AGE_RECIPIENT" -o "$encrypted_file" "$dump_file"
sha256sum "$encrypted_file" > "${encrypted_file}.sha256"

export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$BACKUP_S3_REGION"
key="postgres/${prefix}/$(basename "$encrypted_file")"

aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$encrypted_file" \
  "s3://${BACKUP_S3_BUCKET}/${key}" --only-show-errors
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "${encrypted_file}.sha256" \
  "s3://${BACKUP_S3_BUCKET}/${key}.sha256" --only-show-errors

echo "Encrypted backup uploaded: ${key}"
