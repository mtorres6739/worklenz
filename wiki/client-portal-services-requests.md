# Client Portal services and requests

Wave 5 starts with two independently gated capabilities:

- `FEATURE_CLIENT_PORTAL_SERVICES`
- `FEATURE_CLIENT_PORTAL_REQUESTS`

Both require `FEATURE_CLIENT_PORTAL=true`. Requests also require Services. The
backend capability response is authoritative, the staff and client navigation hide
disabled areas, and direct disabled routes return 404. Keep both new flags false in
production until the restore-clone and full Client A/Client B browser gates pass.

Invoices, payments, chat, and request attachment delivery are not part of these flags.
Their database/API/UI work must receive separate capabilities and isolation gates.

## Data and isolation model

Migration `2026072400040_portal_services_requests` extends the controlled `portal_*`
identity model rather than the incompatible unfinished upstream portal draft. It adds:

- tenant-scoped service definitions and explicit client assignments;
- tenant/client/membership-scoped requests and status history;
- separately attributable staff/client comments; and
- private attachment metadata whose object keys must never be returned directly.

Composite foreign keys prevent a portal membership from submitting, commenting on, or
attaching to another client's request. Client queries always use the authenticated
portal actor's team and client IDs. Private services are visible only through an
explicit `portal_service_clients` assignment; public services are still restricted to
the current tenant.

Staff endpoints remain under `/api/v1/clients/portal` and require owner/admin access.
Client endpoints remain under the separate cookie and CSRF-protected
`/api/client-portal` audience. Request creation and client comments additionally
require comment access and have independent rate limits.

## Current implementation boundary

Implemented behind disabled flags:

- staff service list/create/update/deactivate;
- public or client-assigned service visibility;
- customizable request-form definitions;
- client request submission/list/detail;
- staff request list/detail/status/assignment;
- two-way request comments and portal audit events;
- staff and client routes using the existing Worklenz design system; and
- tenant/client database and query isolation checks.

Not yet releasable:

- request attachment upload/download endpoints and private signed downloads;
- attachment malware/type/content validation for this specific workflow;
- request notifications and real-time events;
- isolated production-restore API/browser rehearsal; and
- production enablement.

The client UI explains that secure request attachments are unavailable rather than
embedding base64 data or exposing an object-storage key.

## Validation and release procedure

1. Run backend CE typecheck and the client portal security, capability, and new query
   isolation tests.
2. Build the CE frontend with every Sentry upload variable unset.
3. Initialize an empty PostgreSQL database, apply the full migration chain twice, and
   assert all six Wave 5 tables and composite constraints.
4. Run `infra/production/scripts/rehearse-migration.sh` for the Wave 5 migration against
   the newest encrypted production restore.
5. Add attachment authorization endpoints and extend the restore-clone Client A/Client
   B gate across services, requests, comments, attachments, search, and Socket.IO.
6. Deploy an immutable SHA with both flags false.
7. Enable Services for the internal workspace, test, then enable Requests and repeat.
8. Remove disposable fixtures, confirm audit records and backups, and only then consider
   the designated client pilot.

Local foundation validation on 2026-07-24 passed backend CE typecheck, targeted security
and isolation tests, a Sentry-disabled frontend production build, high/critical
dependency gates, the commercial-gate inventory, shell validation, and a fresh database
plus repeated migration run.

## Production foundation release

The disabled foundation was released on 2026-07-24 as immutable commit
`5b80cf342a0a6ef79e82f379d6c759df702ad6a3`.

- CI and all four immutable container builds/scans passed.
- The migration was rehearsed twice against an isolated encrypted production restore.
- Deployment created encrypted backup
  `postgres/pre-deploy/worklenz-20260724T191510Z.dump.age`.
- PostgreSQL recorded migration `2026072400040_portal_services_requests`, and all six
  expected tables were verified.
- Backend, frontend, PostgreSQL, and Redis reported healthy; the gateway started and
  the deployment health check passed.
- Authenticated branding, project, and task CRUD passed after deployment.
- The capability response reported `clientPortal=true`,
  `clientPortalServices=false`, and `clientPortalRequests=false`.
- Direct origin HTTPS remained blocked while the Cloudflare route remained available.
- Backup-age monitoring reported a current backup.

This release installs only the gated foundation. Services and Requests remain hidden
and inaccessible until private request attachments and the full restore-clone
Client A/Client B isolation gate are complete.
