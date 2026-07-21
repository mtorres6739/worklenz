# Identity, branding, and Slack

Wave 3 adds original self-hosted implementations for generic OIDC, SDM branding,
and the public Slack integration contract. Branding is released independently.
OIDC and Slack remain fail-closed until their provider setup and acceptance checks
are complete.

## Generic OIDC

Set `FEATURE_OIDC=true` only during a controlled configuration window. An owner or
admin then configures the provider under Settings > Integrations. Client secrets are
encrypted with the deployment `ENCRYPTION_KEY`; API responses expose only masked
configuration metadata.

Register this callback with the identity provider:

`https://projects.myfusionadmin.com/secure/oidc/callback`

The implementation uses Authorization Code flow, PKCE S256, state, nonce, issuer and
audience validation, and a ten-minute session-bound flow. It accepts existing users
in the organization or users with a matching pending invitation. Unknown users are
denied, so OIDC does not create a public signup path. Account creation, invitation
consumption, and identity linking run in one transaction.

Discovery, authorization, token, user-info, JWKS, and logout endpoints must be
credential-free HTTPS URLs resolving only to public addresses. A deliberately
private Authentik or Keycloak deployment requires the explicit host-level override
`OIDC_ALLOW_PRIVATE_ISSUER=true`; document and review that exception before use.

Keep designated owners' local credentials as the emergency fallback. Test provider
discovery, invited login, unknown-user denial, replay denial, logout, and fallback
access before leaving `FEATURE_OIDC=true` in production.

## SDM branding

Owners and admins configure application name, browser title, accent color, logo,
favicon, and email sender identity in Admin Center. The login page receives only the
intentionally public branding fields. Authenticated pages load workspace branding
from `GET /api/v1/system/branding`.

Logo and favicon objects remain private and are rendered through short-lived signed
URLs. Image uploads validate MIME type, magic bytes, and size. Sender addresses must
belong to `ALLOWED_EMAIL_FROM_DOMAINS` or the domain already configured in
`EMAIL_FROM`; that domain must be verified with SES before it is selected.

## Slack

Required host variables:

- `FEATURE_SLACK=true`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`
- optional `SLACK_CALLBACK_URL` if it differs from the canonical URL

Register these Slack app URLs:

- OAuth redirect: `https://projects.myfusionadmin.com/secure/slack/oauth/callback`
- Events: `https://projects.myfusionadmin.com/webhook/slack/events`
- Slash command: `https://projects.myfusionadmin.com/webhook/slack/command`

Requested bot scopes are `channels:join`, `channels:read`, `chat:write`, `commands`,
`groups:read`, `users:read`, and `users:read.email`. The `/worklenz-task` command uses
`/worklenz-task PROJECTKEY Task name`. It maps the Slack user's verified email to an
existing Worklenz member, requires project membership and a channel/project mapping,
and enforces task-creation restrictions.

Webhook requests are verified against the exact raw body, rejected after five
minutes, replay-deduplicated, and rate-limited. Tokens are encrypted at rest and are
revoked on disconnect when Slack is reachable.

Cloudflare Access must have an exact-path bypass for `/webhook/slack/*` before Slack
is enabled. Those paths are safe to expose only because the application verifies
Slack signatures. Do not bypass Access for the OAuth callback, API, or application.

## Release gate

Before either integration is enabled:

1. Rehearse the Wave 3 migration twice against an isolated encrypted production
   restore clone.
2. Confirm the provider callback and webhook URLs through Cloudflare.
3. Complete invited-user, unknown-user, owner-fallback, signature, replay, revocation,
   and tenant-scope tests.
4. Enable one flag at a time and run the internal pilot before client exposure.

