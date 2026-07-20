#!/usr/bin/env bash
set -euo pipefail

deploy_dir="${WORKLENZ_DEPLOY_DIR:-/srv/worklenz}"
cd "$deploy_dir"
set -a
# shellcheck disable=SC1091
source .env
set +a

export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$BACKUP_S3_REGION"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

latest="$(aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3api list-objects-v2 \
  --bucket "$BACKUP_S3_BUCKET" --prefix postgres/daily/ \
  --query 'sort_by(Contents,&LastModified)[-1].LastModified' --output text)"

[[ "$latest" != "None" ]] || { echo "No daily backup found" >&2; exit 1; }
latest_epoch="$(date -d "$latest" +%s)"
age_seconds="$(( $(date +%s) - latest_epoch ))"
[[ "$age_seconds" -le 108000 ]] || { echo "Latest backup is older than 30 hours" >&2; exit 1; }
echo "Latest backup is within 30 hours."
