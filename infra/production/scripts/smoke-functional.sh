#!/usr/bin/env bash
set -euo pipefail

base_url="${WORKLENZ_SMOKE_BASE_URL:-https://127.0.0.1}"
origin_host="Host: ${WORKLENZ_HOSTNAME:-projects.myfusionadmin.com}"

IFS= read -r admin_email
IFS= read -r admin_password
[[ -n "$admin_email" && -n "$admin_password" ]] || {
  echo "Pass the smoke-test email and password as two stdin lines." >&2
  exit 64
}

tmp_dir="$(mktemp -d)"
cookie_jar="$tmp_dir/cookies"
project_id=""
task_id=""

csrf_token() {
  curl -skS -H "$origin_host" -b "$cookie_jar" "$base_url/csrf-token" |
    jq -er '.token'
}

assert_done() {
  local label="$1"
  local response="$2"
  if [[ "$(jq -r '.done // false' <<<"$response")" != "true" ]]; then
    printf '%s failed: %s\n' "$label" \
      "$(jq -c '{done, message, body}' <<<"$response")" >&2
    return 1
  fi
}

cleanup() {
  local token
  token="$(csrf_token 2>/dev/null || true)"
  if [[ -n "$task_id" && -n "$token" ]]; then
    curl -skS -X DELETE -H "$origin_host" -H "X-CSRF-Token: $token" \
      -b "$cookie_jar" "$base_url/api/v1/tasks/$task_id" >/dev/null || true
  fi
  token="$(csrf_token 2>/dev/null || true)"
  if [[ -n "$project_id" && -n "$token" ]]; then
    curl -skS -X DELETE -H "$origin_host" -H "X-CSRF-Token: $token" \
      -b "$cookie_jar" "$base_url/api/v1/projects/$project_id" >/dev/null || true
  fi
  [[ -e "$cookie_jar" ]] && unlink "$cookie_jar" || true
  rmdir "$tmp_dir" 2>/dev/null || true
}
trap cleanup EXIT

curl -skS -H "$origin_host" -o /dev/null -c "$cookie_jar" \
  --data-urlencode "email=$admin_email" \
  --data-urlencode "password=$admin_password" \
  "$base_url/secure/login"

verify_json="$(curl -skS -H "$origin_host" -b "$cookie_jar" "$base_url/secure/verify")"
[[ "$(jq -r '.authenticated' <<<"$verify_json")" == "true" ]]

branding_json="$(curl -skS -H "$origin_host" -b "$cookie_jar" \
  "$base_url/api/v1/admin-center/organization/branding")"
assert_done "Organization branding read" "$branding_json"
jq -e '
  .body
  | has("display_name")
    and has("accent_color")
    and has("page_title")
    and has("email_from_name")
    and has("email_from_address")
    and has("portal_appearance")
    and has("invoice_appearance")
    and has("logo_url")
    and has("favicon_url")
' <<<"$branding_json" >/dev/null || {
  echo "Organization branding read returned an incomplete response." >&2
  exit 1
}

status_id="$(curl -skS -H "$origin_host" -b "$cookie_jar" \
  "$base_url/api/v1/project-statuses" | jq -er '.body[0].id')"
project_name="Production Smoke Test $(date -u +%Y%m%dT%H%M%SZ)"
project_payload="$(jq -nc --arg name "$project_name" --arg status "$status_id" \
  '{name:$name,color_code:"#1677ff",status_id:$status,notes:"Automated launch acceptance"}')"

token="$(csrf_token)"
project_json="$(curl -skS -H "$origin_host" -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $token" -b "$cookie_jar" --data "$project_payload" \
  "$base_url/api/v1/projects")"
assert_done "Project creation" "$project_json"
project_id="$(jq -er '.body.id' <<<"$project_json")"

project_read="$(curl -skS -H "$origin_host" -b "$cookie_jar" \
  "$base_url/api/v1/projects/$project_id")"
assert_done "Project read" "$project_read"

task_status_id="$(curl -skS -H "$origin_host" -b "$cookie_jar" \
  "$base_url/api/v1/statuses?project=$project_id" | jq -er '.body[0].id')"
task_payload="$(jq -nc --arg project "$project_id" --arg status "$task_status_id" \
  '{name:"Verify production task CRUD",project_id:$project,status_id:$status,assignees:[],labels:[],total_hours:0,total_minutes:0,description:"Launch smoke test"}')"
token="$(csrf_token)"
task_json="$(curl -skS -H "$origin_host" -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $token" -b "$cookie_jar" --data "$task_payload" \
  "$base_url/api/v1/tasks")"
assert_done "Task creation" "$task_json"
task_id="$(jq -er '.body.task.id' <<<"$task_json")"

task_read="$(curl -skS -H "$origin_host" -b "$cookie_jar" \
  "$base_url/api/v1/tasks/info?task_id=$task_id&project_id=$project_id")"
assert_done "Task read" "$task_read"

token="$(csrf_token)"
task_delete="$(curl -skS -X DELETE -H "$origin_host" \
  -H "X-CSRF-Token: $token" -b "$cookie_jar" "$base_url/api/v1/tasks/$task_id")"
assert_done "Task deletion" "$task_delete"
task_id=""

update_payload="$(jq -nc --arg status "$status_id" \
  '{name:"Production Smoke Test Updated",key:"PSM",color_code:"#1677ff",status_id:$status}')"
token="$(csrf_token)"
update_json="$(curl -skS -X PUT -H "$origin_host" -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $token" -b "$cookie_jar" --data "$update_payload" \
  "$base_url/api/v1/projects/$project_id")"
assert_done "Project update" "$update_json"

token="$(csrf_token)"
project_delete="$(curl -skS -X DELETE -H "$origin_host" \
  -H "X-CSRF-Token: $token" -b "$cookie_jar" "$base_url/api/v1/projects/$project_id")"
assert_done "Project deletion" "$project_delete"
project_id=""

echo "Authenticated branding, project, and task CRUD smoke test passed."
