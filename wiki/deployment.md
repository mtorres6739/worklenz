# Deployment runbook

## Required access

- Hetzner Cloud API token for the target project.
- A Worklenz-only Cloudflare R2 infrastructure token plus separate bucket-scoped S3
  credentials for attachments and backups.
- A least-privilege Cloudflare token with DNS, Zone Settings, and Access edit rights
  for `myfusionadmin.com`.
- GitHub package read access on the server and package write access in CI.
- SES credentials limited to sending and the verified `myfusionadmin.com` identity.

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

Cloudflare Access protects the hostname during the pilot. Only the exact
`/public/health` and signed `/webhook/emails/events` paths use separate bypass
applications; application authorization and SNS signature verification still apply at
the origin.

Google and Apple authentication require matching backend feature flags
(`ENABLE_GOOGLE_LOGIN` or `ENABLE_APPLE_LOGIN`) plus the complete provider credential
set. Keep both flags false for the email-and-password pilot. The backend does not
construct or register disabled Passport strategies, and disabled provider routes return
404. This prevents optional OAuth configuration from becoming a startup dependency.

Amazon SNS posts its signed JSON envelope as `text/plain`. Only the
`/webhook/emails/*` route family accepts that content type; the matching topic ARN and
AWS signature are still verified before subscription confirmation or event handling.

On the fixed-network Hetzner host, mask `cloud-init-hotplugd.socket` and its service.
Ubuntu otherwise treats Docker virtual Ethernet interfaces as cloud network hot-plugs
and marks an otherwise healthy reboot as degraded.

## Release

CI builds backend, frontend, database, and gateway images tagged with the full commit
SHA. On the host run:

```bash
REDIS_IMAGE='redis@sha256:reviewed-digest' /srv/worklenz/scripts/deploy.sh <40-char-sha>
```

The deployer takes an encrypted pre-deploy backup, pulls immutable images, runs the
reviewed migration job once, starts the stack, and verifies `/public/health`. A failed
health check restores the previous application images but never pretends to reverse
an incompatible schema migration.

For a release smoke test, securely pipe the initial owner's email and password as two
stdin lines to `/srv/worklenz/scripts/smoke-functional.sh`. The script authenticates,
obtains a CSRF token, performs project and task create/read/update/delete checks, and
removes its fixtures. It never reads credentials from command-line arguments.
