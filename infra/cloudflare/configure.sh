#!/usr/bin/env bash
set -euo pipefail

: "${CF_API_TOKEN:?Use a least-privilege Cloudflare token with DNS, Zone Settings, and Access edit permissions}"
: "${CF_ZONE_ID:?Set the myfusionadmin.com zone ID}"
: "${CF_ACCOUNT_ID:?Set the Cloudflare account ID}"
: "${ORIGIN_IPV4:?Set the new Hetzner origin IPv4 address}"
: "${CF_ACCESS_ALLOWED_EMAILS:?Set comma-separated internal pilot email addresses}"

api="https://api.cloudflare.com/client/v4"
headers=(-H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json")
if [[ -n "${CF_ZONE_SETTINGS_API_TOKEN:-}" ]]; then
  settings_headers=(-H "Authorization: Bearer ${CF_ZONE_SETTINGS_API_TOKEN}" -H "Content-Type: application/json")
elif [[ -n "${CF_GLOBAL_API_KEY:-}" && -n "${CF_AUTH_EMAIL:-}" ]]; then
  settings_headers=(-H "X-Auth-Email: ${CF_AUTH_EMAIL}" -H "X-Auth-Key: ${CF_GLOBAL_API_KEY}" -H "Content-Type: application/json")
else
  echo "Set CF_ZONE_SETTINGS_API_TOKEN, or explicitly load CF_GLOBAL_API_KEY and CF_AUTH_EMAIL for the one-time settings update." >&2
  exit 1
fi
hostname="projects.myfusionadmin.com"

record_id="$(curl -fsS "${headers[@]}" \
  "${api}/zones/${CF_ZONE_ID}/dns_records?type=A&name=${hostname}" | jq -r '.result[0].id // empty')"
record_payload="$(jq -n --arg name "$hostname" --arg content "$ORIGIN_IPV4" \
  '{type:"A",name:$name,content:$content,ttl:1,proxied:true}')"
if [[ -n "$record_id" ]]; then
  curl -fsS -X PUT "${headers[@]}" "${api}/zones/${CF_ZONE_ID}/dns_records/${record_id}" \
    -d "$record_payload" | jq -e '.success' >/dev/null
else
  curl -fsS -X POST "${headers[@]}" "${api}/zones/${CF_ZONE_ID}/dns_records" \
    -d "$record_payload" | jq -e '.success' >/dev/null
fi

for setting in \
  'ssl:{"value":"strict"}' \
  'always_use_https:{"value":"on"}' \
  'min_tls_version:{"value":"1.2"}' \
  'tls_1_3:{"value":"on"}' \
  'websockets:{"value":"on"}'; do
  id="${setting%%:*}"
  payload="${setting#*:}"
  curl -fsS -X PATCH "${settings_headers[@]}" "${api}/zones/${CF_ZONE_ID}/settings/${id}" \
    -d "$payload" | jq -e '.success' >/dev/null
done

app_id="$(curl -fsS "${headers[@]}" "${api}/accounts/${CF_ACCOUNT_ID}/access/apps" \
  | jq -r --arg domain "$hostname" '.result[] | select(.domain == $domain) | .id' | head -n1)"
if [[ -z "$app_id" ]]; then
  app_id="$(curl -fsS -X POST "${headers[@]}" "${api}/accounts/${CF_ACCOUNT_ID}/access/apps" \
    -d "$(jq -n --arg domain "$hostname" '{name:"Worklenz internal pilot",domain:$domain,type:"self_hosted",session_duration:"24h",auto_redirect_to_identity:false}')" \
    | jq -r '.result.id')"
fi

include_rules="$(tr ',' '\n' <<<"$CF_ACCESS_ALLOWED_EMAILS" | sed '/^$/d' | jq -R '{email:{email:.}}' | jq -s .)"
existing_policy="$(curl -fsS "${headers[@]}" \
  "${api}/accounts/${CF_ACCOUNT_ID}/access/apps/${app_id}/policies" \
  | jq -r '.result[] | select(.name == "Internal pilot") | .id' | head -n1)"
policy_payload="$(jq -n --argjson include "$include_rules" \
  '{name:"Internal pilot",decision:"allow",precedence:1,include:$include,exclude:[],require:[]}')"
if [[ -n "$existing_policy" ]]; then
  curl -fsS -X PUT "${headers[@]}" \
    "${api}/accounts/${CF_ACCOUNT_ID}/access/apps/${app_id}/policies/${existing_policy}" \
    -d "$policy_payload" | jq -e '.success' >/dev/null
else
  curl -fsS -X POST "${headers[@]}" \
    "${api}/accounts/${CF_ACCOUNT_ID}/access/apps/${app_id}/policies" \
    -d "$policy_payload" | jq -e '.success' >/dev/null
fi

health_domain="${hostname}/public/health"
health_app_id="$(curl -fsS "${headers[@]}" "${api}/accounts/${CF_ACCOUNT_ID}/access/apps" \
  | jq -r --arg domain "$health_domain" '.result[] | select(.domain == $domain) | .id' | head -n1)"
if [[ -z "$health_app_id" ]]; then
  health_app_id="$(curl -fsS -X POST "${headers[@]}" "${api}/accounts/${CF_ACCOUNT_ID}/access/apps" \
    -d "$(jq -n --arg domain "$health_domain" '{name:"Worklenz health check",domain:$domain,type:"self_hosted",session_duration:"24h"}')" \
    | jq -r '.result.id')"
fi

health_policy_id="$(curl -fsS "${headers[@]}" \
  "${api}/accounts/${CF_ACCOUNT_ID}/access/apps/${health_app_id}/policies" \
  | jq -r '.result[] | select(.name == "Health bypass") | .id' | head -n1)"
health_policy_payload='{"name":"Health bypass","decision":"bypass","precedence":1,"include":[{"everyone":{}}],"exclude":[],"require":[]}'
if [[ -n "$health_policy_id" ]]; then
  curl -fsS -X PUT "${headers[@]}" \
    "${api}/accounts/${CF_ACCOUNT_ID}/access/apps/${health_app_id}/policies/${health_policy_id}" \
    -d "$health_policy_payload" | jq -e '.success' >/dev/null
else
  curl -fsS -X POST "${headers[@]}" \
    "${api}/accounts/${CF_ACCOUNT_ID}/access/apps/${health_app_id}/policies" \
    -d "$health_policy_payload" | jq -e '.success' >/dev/null
fi

configure_webhook_bypass() {
  local route="$1"
  local app_name="$2"
  local policy_name="$3"
  local webhook_domain="${hostname}${route}"
  local webhook_app_id
  local webhook_policy_id
  local webhook_policy_payload

  webhook_app_id="$(curl -fsS "${headers[@]}" "${api}/accounts/${CF_ACCOUNT_ID}/access/apps" \
    | jq -r --arg domain "$webhook_domain" '.result[] | select(.domain == $domain) | .id' | head -n1)"
  if [[ -z "$webhook_app_id" ]]; then
    webhook_app_id="$(curl -fsS -X POST "${headers[@]}" "${api}/accounts/${CF_ACCOUNT_ID}/access/apps" \
      -d "$(jq -n --arg name "$app_name" --arg domain "$webhook_domain" \
        '{name:$name,domain:$domain,type:"self_hosted",session_duration:"24h"}')" \
      | jq -r '.result.id')"
  fi

  webhook_policy_id="$(curl -fsS "${headers[@]}" \
    "${api}/accounts/${CF_ACCOUNT_ID}/access/apps/${webhook_app_id}/policies" \
    | jq -r --arg name "$policy_name" '.result[] | select(.name == $name) | .id' | head -n1)"
  webhook_policy_payload="$(jq -n --arg name "$policy_name" \
    '{name:$name,decision:"bypass",precedence:1,include:[{everyone:{}}],exclude:[],require:[]}')"
  if [[ -n "$webhook_policy_id" ]]; then
    curl -fsS -X PUT "${headers[@]}" \
      "${api}/accounts/${CF_ACCOUNT_ID}/access/apps/${webhook_app_id}/policies/${webhook_policy_id}" \
      -d "$webhook_policy_payload" | jq -e '.success' >/dev/null
  else
    curl -fsS -X POST "${headers[@]}" \
      "${api}/accounts/${CF_ACCOUNT_ID}/access/apps/${webhook_app_id}/policies" \
      -d "$webhook_policy_payload" | jq -e '.success' >/dev/null
  fi
}

configure_webhook_bypass \
  "/webhook/emails/events" \
  "Worklenz signed SES webhook" \
  "Signed SNS bypass"
configure_webhook_bypass \
  "/webhook/emails/resend" \
  "Worklenz signed Resend webhook" \
  "Signed Resend bypass"

echo "Cloudflare DNS, Full Strict TLS settings, internal Access, and exact health/webhook bypasses are configured."
