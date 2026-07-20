# Upgrade and rollback runbook

1. Fetch upstream into the fork's `upstream` remote and pin the proposed commit.
2. Review database migrations, authentication, storage, Socket.IO, open-core seams,
   and Compose changes. Never run upstream upgrade scripts in production.
   Port only reviewed CE-safe schema changes into
   `worklenz-backend/database/production-migrations`; historical upstream SQL and
   open-core migrations are intentionally not replayed.
3. Run CI and the disposable fresh-install test.
4. Restore the latest encrypted backup into an isolated clone and rehearse migrations.
5. Merge to the public fork. CI produces full-SHA images and SBOM/provenance metadata.
6. Run the production deployer with that exact SHA.
7. Verify health, login, CRUD, file access, email, Socket.IO, and reboot recovery.

Application rollback reselects the prior full-SHA images. It is allowed only while the
database schema remains backward compatible. If a migration is not backward compatible,
the reviewed release plan must include a forward fix or full database restore and the
maintenance window required for it.
