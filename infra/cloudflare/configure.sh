#!/usr/bin/env bash
set -euo pipefail

: "${CF_API_TOKEN:?Use a least-privilege Cloudflare token with DNS, Zone Settings, and Access edit permissions}"
: "${CF_ZONE_ID:?Set the myfusionadmin.com zone ID}"
: "${CF_ACCOUNT_ID:?Set the Cloudflare account ID}"
: "${ORIGIN_IPV4:?Set the new Hetzner origin IPv4 address}"
: "${CF_ACCESS_ALLOWED_EMAILS:?Set comma-separated internal pilot email addresses}"

api="https://api.cloudflare.com/client/v4"
headers=(-H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json")
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
  curl -fsS -X PATCH "${headers[@]}" "${api}/zones/${CF_ZONE_ID}/settings/${id}" \
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

echo "Cloudflare DNS, Full Strict TLS settings, and internal Access policy are configured."
