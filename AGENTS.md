# Worklenz fork operating rules

- Read `wiki/OVERVIEW.md` before changing application or production infrastructure.
- Production runs only immutable commit-SHA images from this public fork.
- Never use the upstream one-command installer, production `git pull`, floating app images, public MinIO, or anonymous buckets.
- Keep signup invite-only unless a reviewed change explicitly alters the deployment policy.
- Keep storage and SES credentials separate. Never commit or print environment values.
- Run backend CE typechecking, frontend production build with Sentry uploads disabled, dependency audits, and the relevant tests before release.
- Record durable deployment, security, migration, backup, and onboarding changes in `wiki/`.
