import db from "../config/db";
import { log_error } from "./utils";

export type EmailDeliveryProvider = "ses" | "resend";

export async function recordEmailDeliveryEvent(
  provider: EmailDeliveryProvider,
  messageId: string,
  eventType: string,
  recipients: string[],
  timestamp: Date,
  details: unknown,
  providerEventId?: string,
): Promise<void> {
  try {
    for (const recipient of Array.from(new Set(recipients))) {
      await db.query(
        `
          INSERT INTO email_delivery_events (
            provider,
            provider_event_id,
            message_id,
            event_type,
            recipient_email,
            timestamp,
            details
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (provider, provider_event_id, recipient_email)
            WHERE provider_event_id IS NOT NULL
          DO NOTHING;
        `,
        [
          provider,
          providerEventId || null,
          messageId,
          eventType,
          recipient,
          timestamp,
          details ? JSON.stringify(details) : null,
        ],
      );
    }
  } catch (error) {
    log_error(error);
    throw error;
  }
}

export async function suppressBouncedEmails(emails: string[]): Promise<void> {
  for (const email of Array.from(new Set(emails))) {
    await db.query(
      `
        INSERT INTO bounced_emails (email)
        VALUES ($1)
        ON CONFLICT (email) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
      `,
      [email],
    );
  }
}

export async function suppressComplainedEmails(emails: string[]): Promise<void> {
  for (const email of Array.from(new Set(emails))) {
    await db.query(
      `
        INSERT INTO spam_emails (email)
        VALUES ($1)
        ON CONFLICT (email) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
      `,
      [email],
    );
  }
}
