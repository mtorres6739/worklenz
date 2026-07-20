# Backup and restore runbook

## Schedule and retention

- `worklenz-backup.timer` runs nightly.
- Dumps use PostgreSQL custom format, are validated with `pg_restore --list`, encrypted
  with an offline age recipient, hashed, and uploaded to the private backup bucket.
- Lifecycle rules retain 30 daily and 12 monthly restore points. Pre-deploy backups are
  retained for 30 days.
- The backup monitor fails when no daily artifact is present or the newest artifact is
  older than 30 hours.
- The attachment bucket is private, uses unique non-overwriting object keys, and aborts
  incomplete multipart uploads after one day. R2 does not expose S3 bucket versioning.
- Backup objects use timestamped immutable keys. R2 bucket locks prevent overwrite or
  deletion for the full 30-day daily, 12-month monthly, and 30-day pre-deploy windows.

## Restore drill

Run `/srv/worklenz/scripts/restore-drill.sh` from an isolated host with the age identity
available only for the duration of the drill. The script downloads and decrypts the
latest encrypted dump, verifies its uploaded SHA-256 sidecar, restores it into a
disposable PostgreSQL container, verifies public tables, and retrieves a sample
attachment. Record the date, commit SHA, backup key, duration, and result without
recording secret material.

RPO is 24 hours. RTO is four hours. A successful isolated restore is mandatory before
the first client pilot and after material database or backup changes.
