'use strict';

/**
 * Align the controlled production schema with the email sender and signed SES
 * webhook handler. The public base schema previously omitted fields that both
 * paths already write.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE email_logs
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS message_id TEXT,
      ADD COLUMN IF NOT EXISTS error_details TEXT,
      ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

    UPDATE email_logs
       SET status = COALESCE(status, 'pending'),
           updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);

    ALTER TABLE email_logs
      ALTER COLUMN status SET DEFAULT 'pending',
      ALTER COLUMN status SET NOT NULL,
      ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP,
      ALTER COLUMN updated_at SET NOT NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'email_logs'::regclass
           AND contype = 'p'
      ) THEN
        ALTER TABLE email_logs
          ADD CONSTRAINT email_logs_pkey PRIMARY KEY (id);
      END IF;

      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'email_logs'::regclass
           AND conname = 'email_logs_status_check'
      ) THEN
        ALTER TABLE email_logs
          ADD CONSTRAINT email_logs_status_check
          CHECK (status::TEXT IN ('pending', 'sent', 'delivered', 'bounced', 'failed', 'complaint'));
      END IF;
    END
    $$;

    CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
    CREATE INDEX IF NOT EXISTS idx_email_logs_message_id ON email_logs(message_id);
    CREATE INDEX IF NOT EXISTS idx_email_logs_email_status ON email_logs(email, status);
    CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_email_logs_message_id_unique
      ON email_logs(message_id) WHERE message_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS email_delivery_events (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      message_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_email_delivery_events_message_id
      ON email_delivery_events(message_id);
    CREATE INDEX IF NOT EXISTS idx_email_delivery_events_email
      ON email_delivery_events(recipient_email);
    CREATE INDEX IF NOT EXISTS idx_email_delivery_events_type
      ON email_delivery_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_email_delivery_events_timestamp
      ON email_delivery_events(timestamp);

    CREATE OR REPLACE FUNCTION update_email_log_status()
    RETURNS TRIGGER AS $$
    BEGIN
      UPDATE email_logs
         SET status = CASE
             WHEN NEW.event_type = 'send' THEN 'sent'
             WHEN NEW.event_type = 'delivery' THEN 'delivered'
             WHEN NEW.event_type = 'bounce' THEN 'bounced'
             WHEN NEW.event_type = 'complaint' THEN 'complaint'
             WHEN NEW.event_type = 'reject' THEN 'failed'
             ELSE status
         END,
         delivered_at = CASE
             WHEN NEW.event_type = 'delivery' THEN NEW.timestamp
             ELSE delivered_at
         END,
         updated_at = CURRENT_TIMESTAMP
       WHERE message_id = NEW.message_id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trigger_update_email_log_status ON email_delivery_events;
    CREATE TRIGGER trigger_update_email_log_status
      AFTER INSERT ON email_delivery_events
      FOR EACH ROW
      EXECUTE FUNCTION update_email_log_status();
  `);
};

exports.down = () => {
  // Delivery history is intentionally retained for immutable rollback.
};
