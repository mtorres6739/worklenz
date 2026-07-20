# Acceptance and rollout gates

## CI and fresh install

- Backend CE typecheck and unit tests pass on Node 20.
- Frontend production build and maintained utility tests pass with Sentry upload
  variables explicitly disabled. Upstream's stale UI test suite is not a release gate.
- Production dependency audit has no critical finding.
- Secret and container scans pass.
- An empty disposable PostgreSQL volume completes base initialization and every migration.

## Security and isolation

- Public signup returns 403; a valid invitation signup succeeds.
- Session cookie attributes, CORS, CSRF, login throttling, and origin filtering pass.
- Anonymous and unauthorized object requests fail; authorized view/download URLs expire.
- Staff, Client A, and Client B fixtures prove project, task, report, search, file, and
  Socket.IO boundaries.

## Functional and operational

- Login, invitations, password resets, project/task CRUD, comments, uploads, timers,
  notifications, refresh, WebSockets, mobile layout, and reboot recovery pass.
- Disk, memory, container health, and backup freshness alerts are active.
- Immutable rollback and isolated PostgreSQL plus object-storage restore drills pass.

One internal business week without an unresolved severity-1 issue gates the designated
client pilot. The isolation review and restore drill gate all-client onboarding.

## Internal launch record: 2026-07-20

Passed before opening the internal pilot:

- Immutable CI and release workflows, including fresh owner registration and session
  deserialization, Sentry-disabled frontend build, dependency audit, secret scan,
  runtime image checks, Nginx validation, and critical container scans.
- Cloudflare Full Strict TLS and Access, exact public-health and signed-SNS bypasses,
  Cloudflare-only origin ingress, restricted SSH, private data networks, and no
  published PostgreSQL or Redis ports.
- Public signup denial, disabled Google and Apple routes, production cookie attributes,
  signed SES webhook confirmation, encrypted backup freshness, isolated PostgreSQL and
  object-storage restore, and host reboot recovery.
- Authenticated owner login/session verification and CSRF-protected project and task
  create, read, update, and delete checks against production.
- Project detail grouping preferences, task-creation policy checks, and project/task
  i18n activity logging are present in both the fresh-install schema and controlled
  production migrations. The final smoke run produced no schema or application errors.
- Schema-compatible rollback from
  `0eed2c4af3fc98da5345c1194d4d87a75e489a29` to
  `7ae62f9d45aaea10bc806fbbe365ba2f6a9cf585`, including a full authenticated
  functional smoke test, followed by a successful redeploy of the current release.
- A new encrypted daily backup, backup-age check, and isolated PostgreSQL plus private
  object-storage restore drill after the final production deployment.

Production release evidence:

- Deployed SHA: `ef6ab439a1801bcacf531fdfbcc482e345f8d389`.
- CI: <https://github.com/mtorres6739/worklenz/actions/runs/29765572464>.
- Immutable release: <https://github.com/mtorres6739/worklenz/actions/runs/29765572619>.

Still gated after the internal launch:

- AWS SES production access and external invitation/password-reset delivery.
- Staff, Client A, and Client B isolation fixtures across API, report, search, file,
  and Socket.IO paths.
- Client-facing rollout, the Kinetic Projects link, and all-client onboarding.
