#!/usr/bin/env bash
set -euo pipefail

: "${S3_ENDPOINT:?Set the Hetzner Object Storage endpoint}"
: "${S3_REGION:?Set the Hetzner Object Storage region}"
: "${S3_ACCESS_KEY_ID:?Load the dedicated Worklenz storage key}"
: "${S3_SECRET_ACCESS_KEY:?Load the dedicated Worklenz storage secret}"
: "${S3_BUCKET:?Set the private attachment bucket name}"
: "${BACKUP_S3_BUCKET:?Set the private backup bucket name}"

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$S3_REGION"
aws_cmd=(aws --endpoint-url "$S3_ENDPOINT")

for bucket in "$S3_BUCKET" "$BACKUP_S3_BUCKET"; do
  "${aws_cmd[@]}" s3api head-bucket --bucket "$bucket" 2>/dev/null || \
    "${aws_cmd[@]}" s3api create-bucket --bucket "$bucket" >/dev/null
  "${aws_cmd[@]}" s3api put-bucket-versioning --bucket "$bucket" \
    --versioning-configuration Status=Enabled
  "${aws_cmd[@]}" s3api put-public-access-block --bucket "$bucket" \
    --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
done

attachments_lifecycle="$(mktemp)"
backups_lifecycle="$(mktemp)"
trap 'rm -f "$attachments_lifecycle" "$backups_lifecycle"' EXIT

cat > "$attachments_lifecycle" <<'JSON'
{"Rules":[{"ID":"abort-incomplete","Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}},{"ID":"old-versions","Status":"Enabled","Filter":{"Prefix":""},"NoncurrentVersionExpiration":{"NoncurrentDays":30}}]}
JSON
cat > "$backups_lifecycle" <<'JSON'
{"Rules":[{"ID":"daily-30","Status":"Enabled","Filter":{"Prefix":"postgres/daily/"},"Expiration":{"Days":30},"NoncurrentVersionExpiration":{"NoncurrentDays":30}},{"ID":"monthly-12","Status":"Enabled","Filter":{"Prefix":"postgres/monthly/"},"Expiration":{"Days":366},"NoncurrentVersionExpiration":{"NoncurrentDays":30}},{"ID":"pre-deploy-30","Status":"Enabled","Filter":{"Prefix":"postgres/pre-deploy/"},"Expiration":{"Days":30},"NoncurrentVersionExpiration":{"NoncurrentDays":30}}]}
JSON

"${aws_cmd[@]}" s3api put-bucket-lifecycle-configuration --bucket "$S3_BUCKET" \
  --lifecycle-configuration "file://${attachments_lifecycle}"
"${aws_cmd[@]}" s3api put-bucket-lifecycle-configuration --bucket "$BACKUP_S3_BUCKET" \
  --lifecycle-configuration "file://${backups_lifecycle}"

echo "Private versioned attachment and backup buckets are configured."
