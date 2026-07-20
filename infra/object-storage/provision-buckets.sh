#!/usr/bin/env bash
set -euo pipefail

: "${CF_ACCOUNT_ID:?Set the Cloudflare account ID}"
: "${CF_R2_ADMIN_API_TOKEN:?Load the Worklenz R2 infrastructure token}"

S3_BUCKET="${S3_BUCKET:-worklenz-attachments-prod}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-worklenz-backups-prod}"
R2_LOCATION_HINT="${R2_LOCATION_HINT:-enam}"

api="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets"
auth=(-H "Authorization: Bearer ${CF_R2_ADMIN_API_TOKEN}" -H "Content-Type: application/json")

for bucket in "$S3_BUCKET" "$BACKUP_S3_BUCKET"; do
  list="$(curl -fsS "$api" "${auth[@]}")"
  exists="$(jq -r --arg bucket "$bucket" 'any(.result.buckets[]?; .name == $bucket)' <<<"$list")"
  if [[ "$exists" != "true" ]]; then
    body="$(jq -cn --arg name "$bucket" --arg location "$R2_LOCATION_HINT" \
      '{name:$name,locationHint:$location}')"
    response="$(curl -fsS -X POST "$api" "${auth[@]}" --data "$body")"
    jq -e '.success == true' <<<"$response" >/dev/null
  fi
done

attachments_lifecycle='{"rules":[{"id":"abort-incomplete-1d","enabled":true,"conditions":{"prefix":""},"abortMultipartUploadsTransition":{"condition":{"type":"Age","maxAge":86400}}}]}'
backups_lifecycle='{"rules":[{"id":"abort-incomplete-1d","enabled":true,"conditions":{"prefix":""},"abortMultipartUploadsTransition":{"condition":{"type":"Age","maxAge":86400}}},{"id":"daily-30","enabled":true,"conditions":{"prefix":"postgres/daily/"},"deleteObjectsTransition":{"condition":{"type":"Age","maxAge":2592000}}},{"id":"monthly-12","enabled":true,"conditions":{"prefix":"postgres/monthly/"},"deleteObjectsTransition":{"condition":{"type":"Age","maxAge":31622400}}},{"id":"pre-deploy-30","enabled":true,"conditions":{"prefix":"postgres/pre-deploy/"},"deleteObjectsTransition":{"condition":{"type":"Age","maxAge":2592000}}}]}'

for spec in "$S3_BUCKET|$attachments_lifecycle" "$BACKUP_S3_BUCKET|$backups_lifecycle"; do
  bucket="${spec%%|*}"
  lifecycle="${spec#*|}"
  response="$(curl -fsS -X PUT "$api/$bucket/lifecycle" "${auth[@]}" --data "$lifecycle")"
  jq -e '.success == true' <<<"$response" >/dev/null
done

backup_locks='{"rules":[{"id":"daily-30-lock","enabled":true,"prefix":"postgres/daily/","condition":{"type":"Age","maxAgeSeconds":2592000}},{"id":"monthly-12-lock","enabled":true,"prefix":"postgres/monthly/","condition":{"type":"Age","maxAgeSeconds":31622400}},{"id":"pre-deploy-30-lock","enabled":true,"prefix":"postgres/pre-deploy/","condition":{"type":"Age","maxAgeSeconds":2592000}}]}'
response="$(curl -fsS -X PUT "$api/$BACKUP_S3_BUCKET/lock" "${auth[@]}" --data "$backup_locks")"
jq -e '.success == true' <<<"$response" >/dev/null

for bucket in "$S3_BUCKET" "$BACKUP_S3_BUCKET"; do
  managed="$(curl -fsS "$api/$bucket/domains/managed" "${auth[@]}")"
  custom="$(curl -fsS "$api/$bucket/domains/custom" "${auth[@]}")"
  jq -e '.success == true and (.result.enabled // false) == false' <<<"$managed" >/dev/null
  jq -e '.success == true and ((.result.domains // []) | length) == 0' <<<"$custom" >/dev/null
done

echo "Private R2 attachment and retention-locked backup buckets are configured."
