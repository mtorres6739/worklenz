# Worklenz self-hosting overview

This fork deploys Worklenz Community Edition as a standalone, separately
authenticated application at `https://projects.myfusionadmin.com`.

## Source and release boundary

- Public fork: `mtorres6739/worklenz`
- Reviewed upstream baseline: `7c808e5fc79bb75396b409a20bc7f71b721d97e1`
- License: AGPL-3.0; corresponding modified source remains public.
- Production images use the full fork commit SHA. Production never builds on the
  host, runs `git pull`, or deploys a floating application tag.
- Kinetic links to Worklenz. It passes no token and uses no iframe.

## Production shape

- Dedicated Hetzner Ashburn CCX13: 2 dedicated vCPU, 8 GB RAM, 80 GB disk.
- Cloudflare proxy and Access in front of a Cloudflare-only Hetzner origin firewall.
- Full Strict TLS terminates at the Nginx gateway using an origin certificate.
- PostgreSQL and Redis have no published ports and use a private Docker network.
- Attachments and encrypted backups use separate private, versioned Hetzner Object
  Storage buckets. Objects are never anonymously readable.
- SES credentials are independent of storage credentials.

## Runbooks

- [Deployment](deployment.md)
- [Security](security.md)
- [Upgrade and rollback](upgrade.md)
- [Backup and restore](backup-restore.md)
- [Client onboarding](client-onboarding.md)
- [Acceptance and rollout gates](acceptance.md)

## Current rollout rule

Start with staff behind Cloudflare Access. Enable the Kinetic link only after one
internal business week without an unresolved severity-1 issue. One designated
client may follow. Broader onboarding stays blocked until isolation coverage and a
full restore drill pass.
