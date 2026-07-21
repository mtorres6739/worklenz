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

Before a release with an additive database change, copy only the reviewed migration
file to the host and run:

```bash
/srv/worklenz/scripts/rehearse-migration.sh /path/to/reviewed-migration.js
```

The rehearsal downloads and verifies the latest encrypted backup, restores it into an
isolated internal Docker network, applies the migration twice with a dedicated tracking
table, verifies the expected finance schema, and removes the disposable database. It
never connects to or modifies the production PostgreSQL service.

RPO is 24 hours. RTO is four hours. A successful isolated restore is mandatory before
the first client pilot and after material database or backup changes.

The finance migration rehearsal completed successfully on 2026-07-21. The helper waits
through the database image's temporary initialization server before restoring, so a
short-lived `pg_isready` response cannot be mistaken for the stable rehearsal target.
