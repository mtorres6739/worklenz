# Client Portal collaboration

Wave 4 implements an original, invite-only client collaboration surface behind
`FEATURE_CLIENT_PORTAL`. The release is fail-closed by default. Wave 5 services,
requests, invoices, payments, and chat remain unrouted and are not part of this flag.

## Released contract

Staff owners and admins can:

- create and deactivate client companies;
- explicitly generate or resend a seven-day, one-time invitation;
- invite additional client members as an admin or member;
- grant one client access to a project as read-only or comment-enabled;
- independently allow or deny that project's files; and
- exchange clearly marked client-visible task messages from the normal task drawer.

Client users can:

- accept an invitation or link an existing portal account;
- sign in and reset their password through the separate portal audience;
- view only explicitly assigned projects, tasks, progress, files, and portal messages;
- comment only when both their membership and project grant allow it; and
- download private objects only through an authorization-checked, 15-minute signed URL.

Client routes use `/portal/*` for authentication and `/client-portal/*` for the
authenticated UI. Kinetic passes no identity or token.

## Identity and request security

Client identities are stored separately from staff users. The portal uses the
`worklenz.client.sid` cookie with `HttpOnly`, production `Secure`, `SameSite=Lax`, and
a 12-hour lifetime. Only a SHA-256 digest of the 256-bit random session token is stored.
JavaScript stores only the per-session CSRF value. Bearer tokens and Socket.IO handshake
tokens are not accepted.

Invitation and reset tokens are also stored only as SHA-256 digests. Invitations expire
after seven days and password reset links after one hour. Passwords require 12 to 128
characters with upper, lower, number, and symbol. Login, invitation, and reset routes use
the existing authentication rate limiters. Mutations require the canonical origin when
the browser sends one and require `X-Client-CSRF` after authentication.

## Tenant isolation

The `2026072100200_client_portal_collaboration` migration creates normalized `portal_*`
tables. Composite foreign keys bind every client membership, project grant, client
comment, and session to the same team/client/user scope. A project has one portal-client
grant at most. This is a deliberate initial operating invariant: never assign a shared
project to two client companies.

Every client API query starts with the authenticated membership's team and client IDs,
then requires an explicit `portal_project_access` row. File listing and signing repeat
the project/team scope. Staff APIs require owner/admin access and also scope clients and
projects to the active team.

Client Socket.IO connections authenticate from the separate cookie, join only their
membership/client/explicit-project rooms, and are never registered for staff mutation
commands. Staff project-room joins now require owner, admin/team-lead, or explicit
project membership before any event room is joined. Deactivating a client or member,
logging out, resetting a password, or removing/reassigning a project grant immediately
disconnects or removes the affected live sockets; revocation does not wait for a browser
refresh or session expiry.

## Operating procedure

1. Keep `FEATURE_CLIENT_PORTAL=false` while deploying the schema and code.
2. Rehearse the migration twice against an encrypted production restore clone.
3. Run Client A and Client B API, file, comment, and Socket.IO isolation fixtures.
4. Set the flag true for the internal SDM workspace only and redeploy the same immutable
   release.
5. Create a disposable client, assign a disposable project, generate an invitation,
   accept it in a separate browser profile, and test read-only, comment, hidden-file,
   visible-file, reset, logout, refresh, and revocation behavior.
6. Remove the disposable client/project and verify the audit log and backup.
7. Complete one internal business week before inviting the designated client pilot.

Cloudflare Access remains in front of both staff and client surfaces during the pilot.
Do not create a broad Access bypass for `/portal`, `/client-portal`, `/api/client-portal`,
or `/socket`.

## Validation evidence

The fork includes unit coverage for token digests, cookie attributes, password policy,
portal CSRF, capability fail-closed behavior, and staff Socket.IO project authorization.
Fresh-install CI asserts all portal tables, the one-client-per-project constraint, and
the composite tenant foreign keys, including the task-to-project comment scope. Its
rolled-back Client A/Client B fixture proves the
scope query and duplicate-project gate. The migration rehearsal helper checks the same
schema invariants after applying the migration twice to a restored encrypted backup.
