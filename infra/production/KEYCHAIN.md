# Production Keychain inventory

All entries use the macOS Keychain account `worklenz-production`. This file records
service names only. It must never contain credential values.

## Cloudflare

- `worklenz-cloudflare-api-token`
- `worklenz-cloudflare-api-token-id`
- `worklenz-r2-admin-api-token`
- `worklenz-r2-attachments-access-key-id`
- `worklenz-r2-attachments-secret-access-key`
- `worklenz-r2-backups-access-key-id`
- `worklenz-r2-backups-secret-access-key`
- `worklenz-origin-ca-certificate`
- `worklenz-origin-ca-certificate-id`
- `worklenz-origin-ca-private-key`

## Application

- `worklenz-production-db-password`
- `worklenz-production-redis-password`
- `worklenz-production-session-secret`
- `worklenz-production-cookie-secret`
- `worklenz-production-jwt-secret`
- `worklenz-production-encryption-key`
- `worklenz-production-encryption-salt`
- `worklenz-initial-admin-password`

## Backups

- `worklenz-production-backup-age-identity`
- `worklenz-production-backup-age-recipient`

## Email

- `worklenz-ses-access-key-id`
- `worklenz-ses-secret-access-key`
- `worklenz-ses-sns-topic-arn`

Retrieve values only at deployment time, pass them directly to the target host over
the encrypted administration channel, and keep `/srv/worklenz/.env` at mode `0600`.
