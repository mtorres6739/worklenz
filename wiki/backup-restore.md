# Backup and restore runbook

## Schedule and retention

- `worklenz-backup.timer` runs nightly.
- Dumps use PostgreSQL custom format, are validated with `pg_restore --list`, encrypted
  with an offline age recipient, hashed, and uploaded to the private backup bucket.
- Lifecycle rules retain 30 daily and 12 monthly restore points. Pre-deploy backups are
  retained for 30 days.
- The backup monitor fails when no daily artifact is present or the newest artifact is
  older than 30 hours.
- The attachment bucket is private and versioned; incomplete multipart uploads and old
  noncurrent versions are cleaned by lifecycle policy.

## Restore drill

Run `/srv/worklenz/scripts/restore-drill.sh` from an isolated host with the age identity
available only for the duration of the drill. The script downloads and decrypts the
latest dump, restores it into a disposable PostgreSQL container, verifies public tables,
and retrieves a sample attachment. Record the date, commit SHA, backup key, duration,
and result without recording secret material.

RPO is 24 hours. RTO is four hours. A successful isolated restore is mandatory before
the first client pilot and after material database or backup changes.
