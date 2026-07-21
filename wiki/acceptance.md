# Acceptance and rollout gates

## CI and fresh install

- Backend CE typecheck and unit tests pass on Node 20.
- Frontend production build and maintained utility tests pass with Sentry upload
  variables explicitly disabled. Upstream's stale UI test suite is not a release gate.
- Production dependency audit has no critical finding.
- Secret and container scans pass.
- An empty disposable PostgreSQL volume completes base initialization and every migration.
- Task-template CI preserves stable keys, descriptions, labels, estimates, and three-level
  hierarchy while legacy templates remain compatible.

## Security and isolation

- Public signup returns 403; a valid invitation signup succeeds.
- Session cookie attributes, CORS, CSRF, login throttling, and origin filtering pass.
- Anonymous and unauthorized object requests fail; authorized view/download URLs expire.
- Staff, Client A, and Client B fixtures prove project, task, report, search, file, and
  Socket.IO boundaries.
- Portal sessions use only the separate client cookie, cross-audience bearer/handshake
  tokens fail, project grants allow one client only, and client-visible comments never
  appear in internal task comments.

## Functional and operational

- Login, invitations, password resets, project/task CRUD, comments, uploads, timers,
  notifications, refresh, WebSockets, mobile layout, and reboot recovery pass.
- Disk, memory, container health, and backup freshness alerts are active.
- Immutable rollback and isolated PostgreSQL plus object-storage restore drills pass.
- Website checklist rehearsal proves 29 exact source checks, three sign-off tasks,
  launch-relative dates, idempotent import, written approval evidence, `Not Applicable`
  completion, and the 31-dependency launch gate.

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
  production migrations.
- A post-launch schema compatibility issue was found when project views queried task
  progress and team reporting fields omitted by the upstream CE base schema. Release
  `2026072000055_application_schema_compatibility` adds those fields, and CI now checks
  them against real task and owner fixtures before release.
- Live admin-center and task creation checks subsequently exposed omitted organization
  calculation fields and an upstream leaf-task division-by-zero function. Migration
  `2026072000060_runtime_schema_compatibility` and fresh-install assertions cover both.
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

## Wave 4 Client Portal gate

The collaboration code and additive schema were initially deployed behind
`FEATURE_CLIENT_PORTAL=false`. The encrypted restore-clone Client A/Client B gate has
now passed and the flag is enabled for the Cloudflare-protected internal SDM pilot.
Wave 5 services, requests, invoices, payments, and chat remain excluded.

### Wave 4 deployment record: 2026-07-21

- Deployed immutable SHA: `4e786c1ca3daf87bbbdf92ce7b0d0739484f9f3e`.
- CI: <https://github.com/mtorres6739/worklenz/actions/runs/29843590055>.
- Immutable release and critical image scans:
  <https://github.com/mtorres6739/worklenz/actions/runs/29843590980>.
- The migration applied twice to an isolated clone of the latest encrypted production
  backup before deployment. All portal tables, the one-client-per-project constraint,
  and seven tenant-scope foreign keys passed.
- The deployer created an encrypted pre-deploy backup, applied the additive production
  migration, started the SHA-pinned images, and passed origin and public health checks.
- A new encrypted daily backup was created after deployment; backup-age monitoring and
  the isolated PostgreSQL plus object-storage restore drill passed.
- `FEATURE_CLIENT_PORTAL=false` remains confirmed in production. The portal API returns
  404 and no client can access the unfinished pilot surface.

The preceding record is the fail-closed schema deployment. It was superseded by the
internal pilot activation below.

### Wave 4 internal pilot activation: 2026-07-21

- Deployed immutable SHA: `bdebdc5cf0aa7f8219a41bba0d539540c52e4c90`.
- CI: <https://github.com/mtorres6739/worklenz/actions/runs/29850765281>.
- Immutable release and critical image scans:
  <https://github.com/mtorres6739/worklenz/actions/runs/29850765557>.
- The first restore-clone pass exposed the missing `project_files` production table.
  Additive migration `2026072100210_portal_file_scope` now creates it and validates
  composite tenant scope for project files and task attachments. The migration passed
  twice on the encrypted restore clone before production.
- The next pass exposed a 500 response for rejected CORS origins and a missing
  `X-Client-CSRF` preflight header. The release now returns 403 for blocked origins and
  permits the required portal CSRF header only from configured origins.
- The final encrypted-clone run passed authentication, cookie, CSRF, CORS, project/task,
  comment, file, signed-download, audit, Socket.IO room, and logout-revocation checks for
  disposable Client A and Client B fixtures. No fixture touched production.
- Production runs the exact SHA with `FEATURE_CLIENT_PORTAL=true`; all containers are
  healthy, the anonymous portal session endpoint returns 401, the canonical preflight
  returns 204 with the correct headers, Cloudflare Access returns an authentication
  redirect, and direct origin access remains blocked.
- The deployer created an encrypted pre-deploy backup. A new encrypted daily backup,
  backup-age check, and production schema verification passed after activation.

Still gated before the designated external client:

- staff-UI creation, invitation, reset, refresh, hidden/visible-file, and revocation
  walkthrough in a separate browser profile;
- one internal business week without an unresolved severity-1 issue; and
- explicit Cloudflare Access enrollment for the designated client's identities.
