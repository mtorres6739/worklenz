# SDM self-hosted capability profile

The CE build identifies itself as `self_hosted_full`; it never claims to be the private
Worklenz EE edition. `GET /api/v1/system/capabilities` is the authoritative client
contract. Core public features are enabled without commercial quotas. Server-backed
modules are exposed only when their release flag is true.

Released flags:

- `FEATURE_PROJECT_FINANCE=true`

Fail-closed flags until their independent isolation and integration gates pass:

- Client Portal, Slack, OIDC, Teams, GitHub, Drive, Google Calendar, Microsoft
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
- Waves 3 through 7 remain fail-closed. OIDC, Slack, Client Portal, advertised provider
  integrations, and curated plugins must not be enabled until their backend,
  migrations, provider validation, and isolation tests are complete.

The compatibility inventory is an upper-bound test, not permission to add new legacy
gates. Its checked-in counts must be lowered whenever compatibility code is removed.
