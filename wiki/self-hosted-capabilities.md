# SDM self-hosted capability profile

The CE build identifies itself as `self_hosted_full`; it never claims to be the private
Worklenz EE edition. `GET /api/v1/system/capabilities` is the authoritative client
contract. Core public features are enabled without commercial quotas. Server-backed
modules are exposed only when their release flag is true.

Released flags:

- `FEATURE_PROJECT_FINANCE=true`

Implemented but fail-closed until provider configuration and independent integration
gates pass:

- `FEATURE_OIDC=false`
- `FEATURE_SLACK=false`

Later-wave fail-closed flags:

- Client Portal, Teams, GitHub, Drive, Google Calendar, Microsoft
  Calendar, and curated plugins.

The temporary frontend adapter reports commercial access for legacy public components,
but new code must call `hasCapability()`. `scripts/check-self-hosted-gates.js` records
the remaining compatibility debt and fails CI if any old paywall token count increases.
Counts may only stay equal or decrease.

RBAC is not a commercial gate. Owner/admin, team lead, project manager, member, and
future client permissions remain enforced. Operational limits also remain: uploads
default to 250 MB, dangerous file types stay blocked, SVG/XML content is sanitized,
and object storage remains private.

Billing, trials, expiration redirects, seat counters, and upgrade prompts are absent
from active self-hosted navigation. The deployed legal/about surface must continue to
identify the fork as AGPL-3.0 and link to the public corresponding source.

## Wave status

- Wave 1 is implemented: authoritative capabilities, public-feature unlocks,
  commercial navigation removal, complete activity retention, and configurable 250 MB
  attachments.
- Wave 2 is implemented behind `FEATURE_PROJECT_FINANCE`: organization/project rate
  cards, hourly and man-day calculations, historical rate snapshots, finance RBAC,
  leaf fixed costs, descendant rollups, and Excel export.
- Wave 3 branding, generic OIDC, and Slack code is implemented. Branding is released;
  OIDC and Slack stay disabled until provider credentials, Cloudflare routing, and
  live callback tests pass. See [Identity, branding, and Slack](identity-branding-slack.md).
- Waves 4 through 7 remain fail-closed. Client Portal, advertised provider
  integrations, and curated plugins must not be enabled until their backend,
  migrations, provider validation, and isolation tests are complete.

The compatibility inventory is an upper-bound test, not permission to add new legacy
gates. Its checked-in counts must be lowered whenever compatibility code is removed.

## Production rollout evidence

Waves 1 and 2 were deployed on 2026-07-21 as immutable release
`21fbc6a049a1448164db21e68952b2901d31adac`. The release passed the full CI workflow
and high/critical container scan. Deployment created and uploaded an encrypted
pre-deploy backup, applied the additive finance migration, and passed the automated
health check.

Post-deploy acceptance confirmed:

- all application and database containers run the exact release SHA;
- authenticated project/task CRUD succeeds and leaves no smoke-test project behind;
- the capability response identifies `self_hosted_full`, enables project finance,
  leaves unfinished modules disabled, and returns unlimited commercial quotas;
- the session cookie is `Secure`, `HttpOnly`, and `SameSite`, while unauthenticated
  capability access returns HTTP 401;
- the Cloudflare health path succeeds and direct public access to the Hetzner origin
  is blocked; and
- the latest encrypted backup is inside the 30-hour monitoring threshold.
