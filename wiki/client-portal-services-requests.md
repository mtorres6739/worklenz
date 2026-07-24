# Client Portal services and requests

Wave 5 starts with two independently gated capabilities:

- `FEATURE_CLIENT_PORTAL_SERVICES`
- `FEATURE_CLIENT_PORTAL_REQUESTS`
- `FEATURE_CLIENT_PORTAL_REQUEST_NOTIFICATIONS`

All require `FEATURE_CLIENT_PORTAL=true`. Requests also require Services, and request
notifications require Requests. The
backend capability response is authoritative, the staff and client navigation hide
disabled areas, and direct disabled routes return 404. Both capabilities are enabled
for the Cloudflare-protected internal workspace after the release evidence below
passed. The designated external client remains gated.

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

Still outside the current internal-pilot acceptance:

- a separate-browser walkthrough using a designated real client identity; and
- external client enablement.

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

## Private attachment and internal-pilot release

The private attachment release was deployed on 2026-07-24 as immutable commit
`bea85796255201dccdfe39f5fbb11210375861df`.

- [CI run 30121414922](https://github.com/mtorres6739/worklenz/actions/runs/30121414922)
  passed CE typecheck, all tests, secret/filesystem scans, fresh-database migrations,
  dependency gates, the self-hosted gate inventory, and the Sentry-disabled frontend
  build.
- [Immutable build 30121414998](https://github.com/mtorres6739/worklenz/actions/runs/30121414998)
  built and scanned the four exact-SHA application images and independently scanned
  the digest-pinned ClamAV image.
- Deployment created encrypted backup
  `postgres/pre-deploy/worklenz-20260724T194708Z.dump.age`.
- Backend, frontend, PostgreSQL, Redis, and ClamAV were healthy; the gateway and public
  health check passed.
- The isolated restore rehearsal restored the newest encrypted daily backup, applied
  the candidate migration chain, enabled the flags only inside the clone, and passed
  Client A/Client B API, file, search, Socket.IO, CSRF, audit, and logout isolation.
- The exact candidate backend uploaded a clean PDF through the real private object
  storage path, downloaded identical bytes through a five-minute signed URL, deleted
  the object and metadata, and rejected EICAR without leaving attachment metadata or
  exposing the scanner signature.
- Production was enabled in two steps: Services with Requests still false, then
  Requests. The authenticated capability contract and both staff read APIs passed
  after each restart.
- Authenticated branding/project/task CRUD passed and removed its disposable fixtures.
- Cloudflare returned the Access redirect for the app, the public health bypass
  returned 200, and direct origin HTTPS remained blocked.

The internal staff pilot now runs with
`FEATURE_CLIENT_PORTAL_SERVICES=true` and
`FEATURE_CLIENT_PORTAL_REQUESTS=true`. This does not authorize the designated external
client pilot; that still requires the separate-browser walkthrough and pilot approval.

## Request notifications and real-time event candidate

Migration `2026072400050_portal_request_notifications` adds durable, separately scoped
notification records without mixing client identities into the staff notification
table. It also adds a nullable request link to the existing staff notification model.

- Client notification rows carry team, client, membership, and request IDs. Composite
  foreign keys reject cross-client membership or request combinations.
- Client list, unread-count, mark-read, and mark-all-read queries require all three
  authenticated scope IDs.
- Staff notifications go only to owners, administrators, or an explicitly assigned
  portal administrator. Request administration remains owner/admin-only.
- Socket events target explicit `staff:user:<id>` rooms and
  `portal:client:<team>:<client>` rooms. The staff login event ignores any
  client-supplied user ID and derives room membership from the authenticated session.
- Status changes, assignments, comments, and attachments create durable notification
  records in the same transaction as the request mutation. Realtime emission happens
  only after commit.
- Private attachment object keys and comment bodies are not included in event payloads.
- The UI exposes the client bell only when
  `FEATURE_CLIENT_PORTAL_REQUEST_NOTIFICATIONS=true`.

The candidate is independently fail-closed. Deploy the additive migration and code
with `FEATURE_CLIENT_PORTAL_REQUEST_NOTIFICATIONS=false`, rehearse the exact immutable
SHA on an encrypted restore, and enable it only after the extended Client A/Client B
API and Socket.IO gate passes.

Local candidate validation on 2026-07-24 passed backend CE typecheck, all 24 backend
test suites (104 tests plus one todo), the Sentry-disabled production frontend build,
the self-hosted commercial-gate inventory, high/critical production dependency gates,
shell and JavaScript syntax checks, and a fresh PostgreSQL initialization with the
entire migration chain applied twice.

## Notification and real-time release

Request notifications and explicit-room realtime events were released to the internal
pilot on 2026-07-24 as immutable SHA
`d5dde9770cc870f8f1a8ecc45a7d7eebda537198`.

- [CI run 30124471099](https://github.com/mtorres6739/worklenz/actions/runs/30124471099)
  passed backend CE typecheck, all backend tests, the controlled frontend tests and
  production build, the fresh-database migration gate, dependency audits, secret scan,
  filesystem scan, and self-hosted gate inventory.
- [Immutable build 30124471157](https://github.com/mtorres6739/worklenz/actions/runs/30124471157)
  built and scanned the exact backend, frontend, database, and gateway images and
  independently scanned the pinned ClamAV image.
- The encrypted restore rehearsal applied the candidate's complete migration chain,
  replayed migration `2026072400050` twice, and proved that the composite constraints
  reject cross-client notification rows.
- The extended Client A/Client B gate passed authentication, cookies, CSRF, project and
  file isolation, services, requests, durable notification authorization, clean
  attachment upload/download/delete, EICAR rejection, audit events, Socket.IO room
  isolation, and logout revocation. Client A received its request event while Client B
  received none.
- Deployment created
  `postgres/pre-deploy/worklenz-20260724T203856Z.dump.age`, installed the additive
  schema, and passed the disabled-first health, exact-image, constraint, authenticated
  capability, branding, project, and task CRUD checks.
- After the independent notification flag was enabled, the authenticated capability
  response reported Requests and request notifications true, the functional smoke
  test passed again, Cloudflare health returned 200, the application root remained
  Access-protected, and direct origin access remained blocked.
- The clean post-release backup is
  `postgres/daily/worklenz-20260724T204211Z.dump.age`; backup-age monitoring passed.

This enables notifications only for the protected internal pilot. The external client
gate still requires completion of the internal observation week, explicit Cloudflare
Access enrollment, and the designated separate-browser walkthrough.
