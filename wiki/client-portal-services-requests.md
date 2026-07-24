# Client Portal services and requests

Wave 5 starts with two independently gated capabilities:

- `FEATURE_CLIENT_PORTAL_SERVICES`
- `FEATURE_CLIENT_PORTAL_REQUESTS`

Both require `FEATURE_CLIENT_PORTAL=true`. Requests also require Services. The
backend capability response is authoritative, the staff and client navigation hide
disabled areas, and direct disabled routes return 404. Keep both new flags false in
production until the restore-clone and full Client A/Client B browser gates pass.

Invoices, payments, and chat are not part of these flags. Their database/API/UI work
must receive separate capabilities and isolation gates.

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
- private staff/client request attachments with tenant-scoped metadata;
- allowlisted extension, MIME, and file-signature validation;
- fail-closed ClamAV streaming before private object-storage upload;
- five-minute authorization-checked download URLs and uploader-scoped client deletion;
- staff and client routes using the existing Worklenz design system; and
- tenant/client database and query isolation checks, including foreign attachment
  denial.

Not yet releasable:

- request notifications and real-time events;
- exact-image clean upload and EICAR rejection through the production API;
- isolated production-restore API/browser rehearsal of the candidate image; and
- production enablement.

The UI uploads one file at a time only after a request has a scoped ID. It never embeds
base64 data, accepts client-supplied object references, or exposes object-storage keys.
Required attachment-form questions are therefore fulfilled from the request detail
screen rather than in the initial JSON request payload.

## Attachment release controls

- `PORTAL_REQUEST_ATTACHMENT_MAX_BYTES` defaults to 20 MB and cannot exceed the
  deployment-wide upload limit.
- Production must set `PORTAL_ATTACHMENT_SCAN_MODE=clamav`, `CLAMAV_HOST=clamav`,
  `CLAMAV_PORT=3310`, and an explicit scan timeout.
- The ClamAV image is digest-pinned, runs only on the private data network, publishes no
  host port, and must be healthy before the backend starts.
- A scanner timeout, protocol error, or unavailable daemon returns 503 and stores
  nothing. A malware result returns a generic blocked response and records an audit
  event without persisting the signature or file bytes.
- Allowed files are PDF, common raster images, Office documents, text, and CSV. Active
  SVG/XML, archives, executables, scripts, and extension/MIME/signature mismatches are
  rejected before scanning.
- Object keys include environment, team, client, request, and random attachment ID.
  Download authorization is reevaluated before every five-minute signed URL.

## Validation and release procedure

1. Run backend CE typecheck and the client portal security, capability, and new query
   isolation tests.
2. Build the CE frontend with every Sentry upload variable unset.
3. Initialize an empty PostgreSQL database, apply the full migration chain twice, and
   assert all six Wave 5 tables and composite constraints.
4. Run `infra/production/scripts/rehearse-migration.sh` for the Wave 5 migration against
   the newest encrypted production restore.
5. Start the exact digest-pinned scanner on the candidate host and prove a clean scan
   plus EICAR detection.
6. Extend the restore-clone Client A/Client B gate across services, requests, comments,
   attachment metadata/download authorization, search, and Socket.IO.
7. Deploy an immutable SHA with both flags false.
8. Upload a real allowlisted file through the production API, download it through the
   signed URL, delete it, and verify EICAR is blocked without an object or metadata row.
9. Enable Services for the internal workspace, test, then enable Requests and repeat.
10. Remove disposable fixtures, confirm audit records and backups, and only then consider
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
