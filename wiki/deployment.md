# Deployment runbook

## Required access

- Hetzner Cloud API token for the target project.
- A Worklenz-only Cloudflare R2 infrastructure token plus separate bucket-scoped S3
  credentials for attachments and backups.
- A least-privilege Cloudflare token with DNS, Zone Settings, and Access edit rights
  for `myfusionadmin.com`.
- GitHub package read access on the server and package write access in CI.
- A dedicated Resend team with a sending-only, domain-scoped API key and signed
  webhook secret. SES credentials are optional fallback material only.

Read credentials from the secret environment by variable name. Do not copy unrelated
global credentials into `/srv/worklenz/.env`.

## Local credential inventory

Production material is stored in macOS Keychain under account
`worklenz-production`. The service names are documented in
`infra/production/KEYCHAIN.md`; values must never be copied into this wiki, source,
logs, or command output.

## Provision

1. Load `HETZNER_API_TOKEN` and set `ADMIN_SSH_CIDRS`.
2. Run `infra/hetzner/provision.sh`. It creates the dedicated CCX13, installs the
   host baseline, attaches Cloudflare-only web ingress, and limits SSH.
3. Load `CF_ACCOUNT_ID` and `CF_R2_ADMIN_API_TOKEN`, then run
   `infra/object-storage/provision-buckets.sh`. It creates private Eastern North America
   R2 buckets, lifecycle rules, and backup retention locks. Load the separate
   bucket-scoped S3 credentials only into the matching application or backup variables.
4. Create `/srv/worklenz`, copy the immutable release bundle, set owner-only
   permissions, and populate `.env` from `.env.production.example`.
5. Install the Cloudflare origin certificate at `tls/origin.pem` and
   `tls/origin-key.pem` with mode `0600` on the private key.
6. Configure DNS, Full Strict settings, and the internal Access policy with
   `infra/cloudflare/configure.sh`.
7. Install the systemd backup and freshness-monitor units from
   `infra/production/systemd/` and enable both timers.

Before each SSH administration session, compare the operator's current public address
with the Hetzner `worklenz-production` firewall rule for TCP 22. Mobile and residential
addresses can change. Replace only the stale SSH source with the current single-host
`/32`; never widen SSH to the public internet and do not alter the Cloudflare-only web
rules. Confirm SSH works before beginning a release.

Ubuntu 24.04 does not provide the `awscli` package in the selected Hetzner image.
The cloud-init baseline installs checksum-pinned AWS CLI v2 instead. The backend
production image must retain `node-pg-migrate`; the release workflow runs an image-level
check for the migration binary, pruned runtime modules, and application startup imports
before publishing a deployable artifact. Packages imported by `build/app.js`, including
the Swagger UI and YAML loader, must remain production dependencies.

The Alpine gateway image owns its Nginx `proxy_params` file; do not assume a Debian
Nginx filesystem layout. The release workflow mounts a temporary certificate and runs
`nginx -t` against every gateway image. The deployer also clears inherited application
image variables so only the requested commit SHA can select production images.

The gateway joins both the non-internal `edge` network and the private `app` network.
Docker does not publish host ports for a container attached only to an internal network.
Backend, PostgreSQL, and Redis remain unexposed; only the gateway joins `edge`.

The frontend runtime injects `VITE_API_URL` from `APP_ORIGIN`. Do not leave it empty:
the upstream hostname fallback prepends `api.` and would send authentication requests
to a nonexistent host such as `api.projects.myfusionadmin.com`.

The upstream base initialization omits the separate import-worker SQL directory. The
fork-owned `2026072000010_import_jobs` production migration creates those tables before
`IMPORT_WORKER_ENABLED=true` is used. Its down migration intentionally preserves staged
import data for application-image rollback compatibility.

The open-core base schema also references `sys_license_types` from registration and
session functions without creating the table. The fork-owned
`2026072000005_license_types` migration restores and seeds that lookup before imports.
Fresh-install CI verifies the import table and executes owner registration inside a
rolled-back transaction so schema initialization cannot pass while signup is broken.

The CE base schema removes paid-licensing tables but leaves session functions that
reference them. The fork-owned `2026072000015_ce_licensing_compatibility` migration
adds empty CE compatibility tables plus the self-hosted organization override columns.
Fresh-install CI registers and deserializes a real owner inside a rolled-back
transaction, then creates a project and task. This prevents a release where login
succeeds but core runtime functions reference columns absent from the CE base schema.
The same check clears a project priority and verifies the trigger restores a valid
`sys_project_priorities` default, guarding against task/project priority ID mix-ups.
It also verifies project financial fields, per-member grouping preferences, the
task-creation restriction helper, and project/task i18n activity logging. These fields
and functions are fork-owned production migrations because upstream application code
references them while the upstream CE base schema omits them.

The upstream CE base schema also omits task progress fields and the team reporting
hierarchy field used by current controllers. The fork-owned
`2026072000055_application_schema_compatibility` migration adds the task progress
columns plus `team_members.reports_to_member_id` defensively. Fresh-install CI selects
these fields from real task and owner fixtures so a release cannot pass while project
views would fail with `undefined_column` errors.

The fork-owned `2026072000060_runtime_schema_compatibility` migration adds the
organization calculation and logo fields used by the admin-center controller. It also
replaces the upstream leaf-task progress function, which divided by zero when a task
had no subtasks, with the reviewed manual-progress-aware implementation. Fresh-install
CI selects the organization fields and calculates progress for a real leaf task.

The fork-owned `2026072400020_user_auth_compatibility` migration adds the
`users.apple_id` column and lookup index referenced by current shared authentication
queries. The controlled CE base schema predates upstream Apple sign-in, but password
reset selects this optional identity field even while Apple login is disabled.
Fresh-install CI and the restore-clone rehearsal both execute that query so reset email
cannot regress behind a missing optional-provider column.

The follow-up `2026072400030_password_reset_tokens` migration restores the one-time,
hashed staff password-reset token store that current authentication code requires but
the controlled CE schema omitted. It includes user cleanup and lookup indexes, keeps
rollback data intact, and is exercised transactionally in fresh-install CI and the
encrypted restore-clone rehearsal.

The fork-owned `2026072000065_task-template-accountability` migration adds immutable
template metadata, stable item keys, descriptions, labels, hierarchy, estimates,
launch-relative due offsets, dependencies, and idempotent project-import records. It
also gates the SDM client-approval task from entering a done status until a task comment
or attachment exists. The migration is intentionally rollback-compatible with older
application images: legacy template functions receive generated stable keys, and the
new data is preserved by the no-op down migration. Rehearse it twice against a restored
production clone and once from an empty database before deployment.

The follow-up `2026072000066_task-template-immutable-lock` migration stores the first-
installation lock on the template row. Import history may be removed when a disposable
or client project is deleted, but the installed template version remains immutable.

The `2026072000067_task_member_sort_order` compatibility migration adds the assignee-
group sort column already used by legacy and versioned template imports. Fresh-install
CI selects it from a real task so schema drift cannot break imports only in production.

The fork-owned `2026072100200_client_portal_collaboration` migration adds the separate
client identity/session audience and normalized portal collaboration tables. Composite
foreign keys bind sessions, memberships, comments, clients, projects, and teams to the
same tenant. A unique project grant enforces one client company per project. Deploy this
migration with `FEATURE_CLIENT_PORTAL=false`, rehearse it twice against an encrypted
restore clone, then enable the flag only after the Client A/Client B isolation gate in
[Client Portal collaboration](client-portal-collaboration.md).

The follow-up `2026072100210_portal_file_scope` migration adds the `project_files`
table that the upstream project-file feature expects but the controlled production
chain omitted. It also validates composite project/team and task/project scope for both
project files and task attachments. Rehearse this migration twice and then run
`/srv/worklenz/scripts/rehearse-client-portal.sh` against the exact candidate backend
image before changing the portal release flag.

Cloudflare Access protects the hostname during the pilot. Only the exact
`/public/health`, signed `/webhook/emails/events`, and signed
`/webhook/emails/resend` paths use separate bypass applications. Provider signature
verification still applies at the origin.

Google and Apple authentication require matching backend feature flags
(`ENABLE_GOOGLE_LOGIN` or `ENABLE_APPLE_LOGIN`) plus the complete provider credential
set. Keep both flags false for the email-and-password pilot. The backend does not
construct or register disabled Passport strategies, and disabled provider routes return
404. This prevents optional OAuth configuration from becoming a startup dependency.

Amazon SNS posts its signed JSON envelope as `text/plain`. Only the
`/webhook/emails/*` route family accepts that content type; the matching topic ARN and
AWS signature are still verified before subscription confirmation or event handling.
Resend verification uses the exact raw `application/json` body before global JSON
parsing. Its signing secret and event ID protect against forgery and replay.

On the fixed-network Hetzner host, mask `cloud-init-hotplugd.socket` and its service.
Ubuntu otherwise treats Docker virtual Ethernet interfaces as cloud network hot-plugs
and marks an otherwise healthy reboot as degraded.

## Release

CI builds backend, frontend, database, and gateway images tagged with the full commit
SHA. On the host run:

```bash
REDIS_IMAGE='redis@sha256:reviewed-digest' /srv/worklenz/scripts/deploy.sh <40-char-sha>
```

`REDIS_IMAGE` is required for the first deployment and for an intentional Redis
upgrade. Later deployments reuse the reviewed digest stored in `.release.env`, so
operators do not need to re-enter infrastructure metadata for every application
release.

The deployer takes an encrypted pre-deploy backup, pulls immutable images, runs the
reviewed migration job once, starts the stack, and verifies `/public/health`. A failed
health check restores the previous application images but never pretends to reverse
an incompatible schema migration.

For a release smoke test, securely pipe the initial owner's email and password as two
stdin lines to `/srv/worklenz/scripts/smoke-functional.sh`. The script authenticates,
obtains a CSRF token, performs project and task create/read/update/delete checks, and
removes its fixtures. It never reads credentials from command-line arguments.
