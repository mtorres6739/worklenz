#!/usr/bin/env bash
set -euo pipefail

: "${HETZNER_API_TOKEN:?Load HETZNER_API_TOKEN from the secret environment}"
: "${ADMIN_SSH_CIDRS:?Set comma-separated administration CIDRs, including /32 or /128}"

api="https://api.hetzner.cloud/v1"
auth=(-H "Authorization: Bearer ${HETZNER_API_TOKEN}" -H "Content-Type: application/json")
server_name="worklenz-production"
firewall_name="worklenz-production"

if curl -fsS "${auth[@]}" "${api}/servers?name=${server_name}" | jq -e '.servers[0]' >/dev/null; then
  echo "Server ${server_name} already exists."
  exit 0
fi

mapfile -t cf_sources < <(
  { curl -fsS https://www.cloudflare.com/ips-v4; curl -fsS https://www.cloudflare.com/ips-v6; } | jq -R .
)
mapfile -t ssh_sources < <(tr ',' '\n' <<<"$ADMIN_SSH_CIDRS" | sed '/^$/d' | jq -R .)

cf_json="$(printf '%s\n' "${cf_sources[@]}" | jq -s .)"
ssh_json="$(printf '%s\n' "${ssh_sources[@]}" | jq -s .)"
rules="$(jq -n --argjson cf "$cf_json" --argjson ssh "$ssh_json" '[
  {direction:"in", protocol:"tcp", port:"22", source_ips:$ssh},
  {direction:"in", protocol:"tcp", port:"80", source_ips:$cf},
  {direction:"in", protocol:"tcp", port:"443", source_ips:$cf},
  {direction:"in", protocol:"icmp", source_ips:["0.0.0.0/0","::/0"]}
]')"

firewall_id="$(curl -fsS "${auth[@]}" "${api}/firewalls?name=${firewall_name}" | jq -r '.firewalls[0].id // empty')"
if [[ -z "$firewall_id" ]]; then
  firewall_id="$(curl -fsS -X POST "${auth[@]}" "${api}/firewalls" \
    -d "$(jq -n --arg name "$firewall_name" --argjson rules "$rules" '{name:$name,rules:$rules}')" | jq -r '.firewall.id')"
fi

ssh_keys="$(curl -fsS "${auth[@]}" "${api}/ssh_keys" | jq '[.ssh_keys[].id]')"
user_data="$(cat "$(dirname "$0")/cloud-init.yml")"
payload="$(jq -n \
  --arg name "$server_name" --arg user_data "$user_data" \
  --argjson ssh_keys "$ssh_keys" --argjson firewall_id "$firewall_id" \
  '{name:$name,server_type:"ccx13",image:"ubuntu-24.04",location:"ash",ssh_keys:$ssh_keys,user_data:$user_data,firewalls:[{firewall:$firewall_id}],public_net:{enable_ipv4:true,enable_ipv6:true}}')"

curl -fsS -X POST "${auth[@]}" "${api}/servers" -d "$payload" \
  | jq '{id:.server.id,name:.server.name,ipv4:.server.public_net.ipv4.ip,status:.server.status}'
