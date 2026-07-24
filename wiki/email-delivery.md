# Transactional email delivery

## Provider model

Production selects one provider with `EMAIL_PROVIDER`. `resend` is the preferred
provider for the SDM pilot; `ses` remains an explicitly configured fallback and is
never selected automatically after a provider failure.

The central sender preserves Worklenz suppression filtering and creates one delivery
log per recipient. Resend sends each recipient separately so the provider message ID
matches the delivery, bounce, and complaint event stored for that recipient.

Resend requests use an idempotency key derived from the Worklenz delivery-log ID.
Webhook requests are verified against their exact raw body with the Resend signing
secret. The Svix event ID plus recipient is unique in PostgreSQL, so webhook retries
cannot duplicate delivery state.

Permanent bounces and Resend suppression events enter `bounced_emails`. Complaints
enter `spam_emails`. Both lists are checked before any later send.

## Production setup

- Resend team: `Worklenz`
- Plan: Transactional Free, 3,000 emails per month for the internal pilot
- Sending domain: `notifications.myfusionadmin.com`
- Sender: `Worklenz <noreply@notifications.myfusionadmin.com>`
- Webhook: `https://projects.myfusionadmin.com/webhook/emails/resend`
- Webhook events: sent, delivered, delivery delayed, bounced, complained, failed,
  and suppressed
- API key: sending-only and restricted to the Worklenz sending domain

Store the API key and webhook secret only in the macOS Keychain services documented
in `infra/production/KEYCHAIN.md` and `/srv/worklenz/.env` with mode `0600`.

The free allowance is sufficient for the internal pilot and does not require a second
Resend account. Upgrade the dedicated `Worklenz` team before its monthly volume reaches
the free allowance; do not move this application's credentials into another team's
domain.

Create the exact DNS records returned by Resend in Cloudflare. Email DNS records must
remain DNS-only; never proxy them. Wait for Resend to report the domain verified
before changing production.

Set:

```dotenv
EMAIL_PROVIDER=resend
EMAIL_FROM=Worklenz <noreply@notifications.myfusionadmin.com>
RESEND_API_KEY=<keychain value>
RESEND_WEBHOOKS_ENABLED=true
RESEND_WEBHOOK_SECRET=<keychain value>
SES_WEBHOOKS_ENABLED=false
```

## Release gate

1. Rehearse `2026072400010_email_provider_tracking` twice against an isolated restore
   of the newest encrypted production backup.
2. Confirm the exact Resend webhook path bypasses Cloudflare Access while the parent
   application remains protected.
3. Deploy immutable commit-SHA images through the production deployer.
4. Confirm invalid webhook signatures return 400 and valid event replays create only
   one stored provider event.
5. Send one invitation and one password-reset message to approved internal addresses.
6. Confirm each message is delivered, the matching Worklenz delivery log advances to
   `delivered`, and no secret or message body appears in deployment logs.
7. Create a clean encrypted daily backup and run the backup-age check.

## Production acceptance

The release gate passed on July 24, 2026 with immutable SHA
`8b8ba66202c83550fb60c1e90f79f78315d4be21`:

- the domain and sender identity are verified;
- the exact Cloudflare webhook bypass is active while the application remains behind
  Access;
- invalid signatures are rejected and signed replays are idempotent;
- direct, password-reset, and invitation-template messages reached `delivered`;
- the password-reset smoke token was invalidated and the invitation smoke created no
  application state; and
- the clean encrypted backup and backup-age checks passed.

Resend is now the active production provider. AWS SES remains disabled as an optional
future fallback. External client invitations still require the normal Cloudflare
Access enrollment and client rollout approval; email delivery itself is no longer a
blocker.
