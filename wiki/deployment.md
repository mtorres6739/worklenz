# Deployment runbook

## Required access

- Hetzner Cloud API token for the target project.
- A dedicated Worklenz Hetzner Object Storage key pair generated in Hetzner Console.
- A least-privilege Cloudflare token with DNS, Zone Settings, and Access edit rights
  for `myfusionadmin.com`.
- GitHub package read access on the server and package write access in CI.
- SES credentials limited to sending and the verified `myfusionadmin.com` identity.

Read credentials from the secret environment by variable name. Do not copy unrelated
global credentials into `/srv/worklenz/.env`.

## Provision

1. Load `HETZNER_API_TOKEN` and set `ADMIN_SSH_CIDRS`.
2. Run `infra/hetzner/provision.sh`. It creates the dedicated CCX13, installs the
   host baseline, attaches Cloudflare-only web ingress, and limits SSH.
3. Generate a dedicated S3 key pair in Hetzner Console, load only that pair, and run
   `infra/object-storage/provision-buckets.sh`.
4. Create `/srv/worklenz`, copy the immutable release bundle, set owner-only
   permissions, and populate `.env` from `.env.production.example`.
5. Install the Cloudflare origin certificate at `tls/origin.pem` and
   `tls/origin-key.pem` with mode `0600` on the private key.
6. Configure DNS, Full Strict settings, and the internal Access policy with
   `infra/cloudflare/configure.sh`.
7. Install the systemd backup and freshness-monitor units from
   `infra/production/systemd/` and enable both timers.

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
