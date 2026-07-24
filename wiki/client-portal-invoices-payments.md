# Client Portal invoices and payments

This wave adds tenant-scoped invoices, manual payment evidence, and hosted Stripe
Checkout behind three independent, chained capabilities:

- `FEATURE_CLIENT_PORTAL_INVOICES`
- `FEATURE_CLIENT_PORTAL_PAYMENTS`
- `FEATURE_STRIPE_CHECKOUT`

Invoices require `FEATURE_CLIENT_PORTAL=true`. Payments require Invoices. Stripe
Checkout requires Payments plus deployment credentials. All three flags default to
false and direct disabled routes return 404.

## Data and security model

Migration `2026072400060_portal_invoices_payments` adds:

- invoices and immutable line items scoped by team and client;
- organization payment settings;
- payment attempts for Stripe and manual reconciliation;
- private manual-payment evidence metadata;
- idempotent Stripe webhook receipts containing only hashes and provider IDs; and
- client/staff invoice notification references.

Composite foreign keys bind invoices, payments, evidence, requests, and notifications
to the same team/client scope. A partial unique index permits only one active payment
attempt per invoice, preventing a manual-evidence/card-payment race. The database also
enforces currency, totals, refund bounds, line-item arithmetic, and valid state values.

The server recalculates subtotal, discounts, tax, and total from normalized line items.
Browser-supplied aggregate totals are ignored. Draft updates use an optimistic version
and sent invoices cannot be edited. PDFs use the configured invoice identity, accent
color, footer, and a short-lived private logo URL; PDF generation has its own rate
limit.

No card number, CVC, payment method, or raw Stripe event is stored or handled by
Worklenz. The browser is redirected to Stripe-hosted Checkout. A success redirect is
informational only; only a valid, signed, amount-checked webhook can mark an invoice
paid. Invoice delivery uses a stable per-invoice/per-recipient Resend idempotency key
so a retry cannot generate a second message after a transient application failure.

## Stripe configuration

Required only when `FEATURE_STRIPE_CHECKOUT=true`:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_EXPECTED_ACCOUNT_ID`

Production refuses to start when one is missing. It verifies that the secret key
belongs to the expected account before enabling organization Stripe settings. A live
key or live webhook is rejected unless `STRIPE_ALLOW_LIVE_PAYMENTS=true` is explicitly
set.

Configure the Stripe endpoint as:

`https://projects.myfusionadmin.com/webhook/stripe/portal/events`

Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `payment_intent.payment_failed`
- `charge.refunded`

Webhook signatures are verified against the exact raw request bytes. Receipts are
deduplicated by Stripe event ID and payload SHA-256. Metadata, team/client scope,
currency, and amount must match the server-created payment attempt. Full refunds reopen
the invoice; partial refunds are recorded without incorrectly marking the invoice
unpaid.

## Manual payment evidence

Owners/admins configure whether manual payments are accepted and provide instructions.
Clients may upload one allowlisted evidence file after an invoice is sent. The existing
private portal upload controls apply:

- deployment-size limit and endpoint rate limit;
- extension, MIME, and file-signature validation;
- fail-closed ClamAV scanning;
- private tenant/client/invoice object keys; and
- five-minute authorization-checked staff download URLs.

Only an owner/admin can accept or reject evidence. Accepting records the payment and
marks the invoice paid. A staff member can also record an external/manual payment, but
must provide a reference. Payment references and evidence decisions are audit logged.

## API surfaces

Staff APIs use the existing owner/admin-protected
`/api/v1/clients/portal` namespace. They cover invoice CRUD/send/PDF, payment settings,
manual reconciliation, and evidence review.

Client APIs use the separate cookie and CSRF-protected `/api/client-portal` audience.
They cover scoped invoice list/detail/PDF, payment settings, hosted checkout creation,
and evidence upload. Client invoice queries exclude drafts and always use the
authenticated portal actor's team and client IDs.

## Release procedure

1. Keep all three flags false.
2. Run backend CE typecheck, all backend tests, the Sentry-disabled frontend build,
   dependency gates, commercial-gate inventory, secret scan, and container scans.
3. Initialize an empty PostgreSQL database, apply the full migration chain twice, and
   run `database/tests/portal-invoices-isolation.sql`.
4. Apply the exact candidate migration twice to an isolated encrypted production
   restore clone. Verify tables, constraints, indexes, and existing portal data.
5. Extend the Client A/Client B gate across invoice list/detail/PDF, request links,
   notifications, evidence metadata/downloads, search, and Socket.IO.
6. Deploy exact commit-SHA images with all flags false and verify health, backup,
   authenticated capability output, and direct-route denial.
7. Enable Invoices for the internal workspace and run draft/edit/send/PDF tests.
8. Enable Payments and test manual instructions, clean evidence, malware rejection,
   accept/reject, audit events, and payment-race rejection.
9. In Stripe test mode, enable Checkout and test success, async failure, duplicate
   webhook, modified signature, expired-session replacement, partial/full refund, and
   amount/metadata mismatch.
10. Enable live payments only after the expected Stripe account, signed webhook,
    reconciliation, refund, backup, and rollback evidence is reviewed.

## Candidate and production-foundation evidence

On 2026-07-24 the candidate passed:

- backend CE typecheck and the actual container build path;
- all 26 backend test suites, 111 passing tests and one todo;
- server-side total and Stripe exact-byte signature tests;
- a Sentry-disabled CE frontend production build;
- the self-hosted commercial-gate inventory;
- production dependency audits with zero critical/high findings;
- an empty PostgreSQL initialization and the complete migration chain;
- a second no-op migration run; and
- tenant, line-total, refund-bound, cross-scope payment, and active-payment-race
  database checks.

Immutable SHA `809c0af8c4ff660851e2a0690452e125fbe4ad88` then passed:

- CI run <https://github.com/mtorres6739/worklenz/actions/runs/30128177691>;
- immutable image builds and critical scans in
  <https://github.com/mtorres6739/worklenz/actions/runs/30128177681>;
- the full migration chain against an isolated restore of the newest encrypted
  production backup;
- two idempotent replays of `2026072400060`, including invoice arithmetic, refund,
  cross-client, and active-payment constraints;
- exact-SHA production deployment and backend, frontend, database, gateway, Redis,
  ClamAV, schema, public-health, backup-age, and authenticated CRUD checks; and
- a clean encrypted post-deploy backup at
  `postgres/daily/worklenz-20260724T214422Z.dump.age`.

The production foundation is deployed, but Invoices, Payments, and Stripe Checkout
remain false. This is intentional: invoice access still needs the expanded Client
A/Client B isolation gate and the staged staff/client workflow walkthrough. Stripe also
needs a Worklenz-specific account decision, test-mode credentials, a signed webhook,
and test-mode reconciliation evidence before configuration or activation.
