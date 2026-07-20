# Security runbook

## Enforced controls

- `ALLOW_SIGNUPS=false` is required at production startup.
- Signup works only with both invitation identifiers; the public signup link is hidden.
- Production session cookies are `Secure`, `HttpOnly`, and `SameSite=Lax`.
- CORS and Socket.IO origins are restricted to `projects.myfusionadmin.com`.
- Login, signup, password reset, password update, and invitation routes are throttled
  in the application; Nginx adds a second origin-side throttle.
- Production SQL injection blocking is enabled.
- File lists and downloads use project/task authorization and short-lived signed URLs.
- SES webhook processing is disabled by default and, when enabled, requires a matching
  SNS topic plus a valid AWS SNS signature.
- Sentry source-map upload is fail-closed unless `SENTRY_UPLOAD_SOURCEMAPS=true` is
  intentionally set with complete release credentials.

## Credential separation

Generate Worklenz-only database, Redis, session, cookie, JWT, encryption, backup, R2,
and SES secrets. Use separate bucket-scoped R2 credentials for attachments and backups,
and keep the R2 infrastructure token off the server. Keep `/srv/worklenz/.env` at mode
`0600`. Never expose secrets through frontend variables, logs, wiki files, or GitHub
source.

## Dependency policy

CI fails on critical production dependency findings. The fork upgraded `jspdf` to
remove the known critical frontend advisory. Remaining high findings must be triaged
against reachable production code before each client rollout; an exploitable finding
blocks release.

## Client isolation boundary

Clients are ordinary restricted project members, not team leads or admins. Task,
comment, work-log, task-file, comment-file, project-file, search, report, and real-time
paths must all resolve authorization from the authenticated user and project membership.
The Community Edition client portal is not used.
