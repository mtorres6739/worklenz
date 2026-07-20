#!/usr/bin/env bash
set -euo pipefail

: "${CF_API_TOKEN:?Set the Worklenz Cloudflare DNS token}"
: "${CF_ZONE_ID:?Set the myfusionadmin.com zone ID}"
: "${SES_REGION:=us-west-2}"

identity="myfusionadmin.com"
topic_name="worklenz-ses-events"
api="https://api.cloudflare.com/client/v4"
headers=(-H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json")

if ! aws sesv2 get-email-identity --region "$SES_REGION" --email-identity "$identity" >/dev/null 2>&1; then
  aws sesv2 create-email-identity --region "$SES_REGION" --email-identity "$identity" >/dev/null
fi

topic_arn="$(aws sns create-topic --region "$SES_REGION" --name "$topic_name" --query TopicArn --output text)"
for notification_type in Bounce Complaint Delivery; do
  aws ses set-identity-notification-topic --region "$SES_REGION" \
    --identity "$identity" --notification-type "$notification_type" --sns-topic "$topic_arn"
done

upsert_cname() {
  local name="$1"
  local content="$2"
  local record_id
  record_id="$(curl -fsS "${headers[@]}" \
    "$api/zones/$CF_ZONE_ID/dns_records?type=CNAME&name=$name" | jq -r '.result[0].id // empty')"
  local payload
  payload="$(jq -n --arg name "$name" --arg content "$content" \
    '{type:"CNAME",name:$name,content:$content,ttl:3600,proxied:false}')"
  if [[ -n "$record_id" ]]; then
    curl -fsS -X PUT "${headers[@]}" "$api/zones/$CF_ZONE_ID/dns_records/$record_id" \
      -d "$payload" | jq -e '.success' >/dev/null
  else
    curl -fsS -X POST "${headers[@]}" "$api/zones/$CF_ZONE_ID/dns_records" \
      -d "$payload" | jq -e '.success' >/dev/null
  fi
}

while IFS= read -r token; do
  upsert_cname "${token}._domainkey.${identity}" "${token}.dkim.amazonses.com"
done < <(aws sesv2 get-email-identity --region "$SES_REGION" --email-identity "$identity" \
  --query 'DkimAttributes.Tokens[]' --output text | tr '\t' '\n')

if [[ "${SUBSCRIBE_WEBHOOK:-false}" == "true" ]]; then
  endpoint="https://projects.myfusionadmin.com/webhook/emails/events"
  existing="$(aws sns list-subscriptions-by-topic --region "$SES_REGION" --topic-arn "$topic_arn" \
    --query "Subscriptions[?Endpoint=='$endpoint'] | length(@)" --output text)"
  if [[ "$existing" == "0" ]]; then
    aws sns subscribe --region "$SES_REGION" --topic-arn "$topic_arn" \
      --protocol https --notification-endpoint "$endpoint" >/dev/null
  fi
fi

echo "SES identity, DKIM DNS, and event topic are configured. Enable the webhook subscription only after the signed endpoint is live."
