'use strict';

/**
 * Make outbound email history provider-aware and make signed webhook delivery
 * idempotent. One provider event can cover multiple recipients, so replay
 * protection is scoped to provider event ID plus recipient.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE email_logs
      ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'ses';

    ALTER TABLE email_delivery_events
      ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'ses',
      ADD COLUMN IF NOT EXISTS provider_event_id TEXT;

    CREATE INDEX IF NOT EXISTS idx_email_logs_provider
      ON email_logs(provider);
    CREATE INDEX IF NOT EXISTS idx_email_delivery_events_provider
      ON email_delivery_events(provider);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_email_delivery_events_provider_event_recipient
      ON email_delivery_events(provider, provider_event_id, recipient_email)
      WHERE provider_event_id IS NOT NULL;
  `);
};

exports.down = () => {
  // Provider history and replay protection are intentionally retained.
};
