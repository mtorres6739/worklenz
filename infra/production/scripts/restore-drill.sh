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
tmp_dir="$(mktemp -d)"
container_name="worklenz-restore-$(date +%s)"
trap 'docker rm -f "$container_name" >/dev/null 2>&1 || true; rm -rf "$tmp_dir"' EXIT

export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$BACKUP_S3_REGION"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

key="$(aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3api list-objects-v2 \
  --bucket "$BACKUP_S3_BUCKET" --prefix postgres/daily/ \
  --query 'sort_by(Contents,&LastModified)[-1].Key' --output text)"
[[ "$key" != "None" ]] || { echo "No backup available for restore drill" >&2; exit 1; }

aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp \
  "s3://${BACKUP_S3_BUCKET}/${key}" "$tmp_dir/backup.age" --only-show-errors
age -d -i "$BACKUP_AGE_IDENTITY_FILE" -o "$tmp_dir/backup.dump" "$tmp_dir/backup.age"
pg_restore --list "$tmp_dir/backup.dump" >/dev/null

docker run -d --name "$container_name" \
  -e POSTGRES_USER=restore -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=restore \
  "$DATABASE_IMAGE" >/dev/null
for _ in {1..30}; do
  docker exec "$container_name" pg_isready -U restore -d restore >/dev/null 2>&1 && break
  sleep 2
done
docker exec -i "$container_name" pg_restore -U restore -d restore --clean --if-exists < "$tmp_dir/backup.dump"
docker exec "$container_name" psql -U restore -d restore -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" | grep -Eq '^[1-9][0-9]*$'

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$S3_REGION"
sample_key="$(aws --endpoint-url "$S3_ENDPOINT" s3api list-objects-v2 --bucket "$S3_BUCKET" \
  --max-items 1 --query 'Contents[0].Key' --output text)"
if [[ "$sample_key" != "None" ]]; then
  aws --endpoint-url "$S3_ENDPOINT" s3 cp "s3://${S3_BUCKET}/${sample_key}" \
    "$tmp_dir/object-sample" --only-show-errors
  test -s "$tmp_dir/object-sample"
fi

echo "Isolated PostgreSQL and object-storage restore drill passed."
