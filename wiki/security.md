# Security runbook

## Enforced controls

- `ALLOW_SIGNUPS=false` is required at production startup.
- Signup works only with both invitation identifiers; the public signup link is hidden.
- Production session cookies are `Secure`, `HttpOnly`, and `SameSite=Lax`.
- CORS and Socket.IO origins are restricted to `projects.myfusionadmin.com`.
- Login, signup, password reset, password update, and invitation routes are throttled
  in the application; Nginx adds a second origin-side throttle.
- Production SQL injection blocking is enabled.
- PostgreSQL request filtering permits Worklenz hex colors and inspects request objects
  with null prototypes; both paths have regression coverage.
- File lists and downloads use project/task authorization and short-lived signed URLs.
- Portal request attachments validate extension, MIME, and file signatures, then stream
  through private ClamAV before storage. Scanner errors fail closed; authorized
  downloads use five-minute signed URLs and never return private object keys.
- The service worker caches only same-origin static assets. Authentication, API, CSRF,
  health, webhook, and socket responses bypass browser caches so authenticated data
  cannot survive logout or be replayed to another user. Protected manifest and static
  fetches include the Cloudflare Access session credential.
- Email delivery supports explicit Resend or SES selection. Resend webhooks require
  an exact-body signature, and provider event IDs are deduplicated in PostgreSQL. SES
  webhook processing requires a matching SNS topic plus a valid AWS SNS signature.
- Sentry source-map upload is fail-closed unless `SENTRY_UPLOAD_SOURCEMAPS=true` is
  intentionally set with complete release credentials.

## Credential separation

Generate Worklenz-only database, Redis, session, cookie, JWT, encryption, backup, R2,
Resend, and optional SES secrets. Use separate bucket-scoped R2 credentials for
attachments and backups, and keep the R2 infrastructure token off the server. Keep
`/srv/worklenz/.env` at mode `0600`. Never expose secrets through frontend variables,
logs, wiki files, or GitHub source.

## Dependency policy

CI fails on critical production dependency findings. The fork upgraded `jspdf` to
remove the known critical frontend advisory. Remaining high findings must be triaged
against reachable production code before each client rollout; an exploitable finding
blocks release.

## SES reputation remediation

The new `us-west-2` production-access request was denied because a retired legacy
sender in `us-west-1` had an unresolved high-bounce enforcement event. Account-level
sending in `us-west-1` is now disabled and must remain disabled. Account suppression
for both bounces and complaints is enabled in both regions.

Production Worklenz email remains transactional and invitation-only. The
`myfusionadmin.com` identity and DKIM are verified in `us-west-2`; bounce, complaint,
and delivery notifications target the signed Worklenz SNS webhook. Test only with the
SES simulator or verified recipients until AWS clears the legacy enforcement and grants
production access in `us-west-2`.

The remediation response was submitted to the legacy enforcement case on 2026-07-24.
It documented retirement of the old workflow, the regional send shutdown, suppression
controls, signed webhook handling, low-rate transactional use, and monitoring. Do not
resubmit the `us-west-2` request until AWS confirms the old enforcement is cleared.

## Resend cutover

The fork now has a provider-aware sender and signed Resend webhook path. Production
uses the dedicated `Worklenz` Resend team and
`notifications.myfusionadmin.com` once the paid team, domain DNS, domain-scoped key,
and webhook are active. SES remains disabled fallback configuration; Resend is not an
automatic failover for AWS and AWS is not an automatic failover for Resend.

## Client isolation boundary

Client Portal identities are separate from staff users and receive only explicit
tenant-scoped project grants. They never become staff owners, admins, team leads, or
project managers. The released collaboration routes cover project/task reads,
client-visible comments, project/task files, signed downloads, and isolated real-time
rooms. Wave 5 Services and Requests, including private request attachments, are
implemented behind disabled capabilities and remain inaccessible until the
restore-clone plus production upload/malware gates pass. Invoices, payments, chat, and
broader portal reports remain unrouted until their own authorization and isolation
gates pass.
