import { Request, Response } from "express";
import { Resend, WebhookEventPayload } from "resend";
import {
  recordEmailDeliveryEvent,
  suppressBouncedEmails,
  suppressComplainedEmails,
} from "../shared/email-delivery-events";
import { log_error } from "../shared/utils";

type ResendEmailEvent = Extract<
  WebhookEventPayload,
  { data: { email_id: string; to: string[] } }
>;

const eventTypeMap: Partial<Record<ResendEmailEvent["type"], string>> = {
  "email.sent": "send",
  "email.delivered": "delivery",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounce",
  "email.complained": "complaint",
  "email.failed": "reject",
  "email.suppressed": "reject",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.scheduled": "scheduled",
};

export function mapResendEventType(
  type: ResendEmailEvent["type"],
): string | undefined {
  return eventTypeMap[type];
}

function isResendEmailEvent(
  event: WebhookEventPayload,
): event is ResendEmailEvent {
  return (
    event.type.startsWith("email.") &&
    "email_id" in event.data &&
    Array.isArray(event.data.to)
  );
}

export default class ResendWebhookController {
  public static async handle(req: Request, res: Response): Promise<Response> {
    if (process.env.RESEND_WEBHOOKS_ENABLED !== "true") {
      return res.status(404).end();
    }

    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    const apiKey = process.env.RESEND_API_KEY;
    const svixId = req.header("svix-id");
    const svixTimestamp = req.header("svix-timestamp");
    const svixSignature = req.header("svix-signature");

    if (
      !webhookSecret ||
      !apiKey ||
      !svixId ||
      !svixTimestamp ||
      !svixSignature ||
      typeof req.body !== "string"
    ) {
      return res.status(400).json({ done: false, message: "Invalid webhook request." });
    }

    let event: WebhookEventPayload;
    try {
      event = new Resend(apiKey).webhooks.verify({
        payload: req.body,
        headers: {
          id: svixId,
          timestamp: svixTimestamp,
          signature: svixSignature,
        },
        webhookSecret,
      });
    } catch (error) {
      log_error(error);
      return res.status(400).json({ done: false, message: "Invalid webhook signature." });
    }

    try {
      if (!isResendEmailEvent(event)) {
        return res.status(200).json({ done: true });
      }

      const eventType = mapResendEventType(event.type);
      if (!eventType) {
        return res.status(200).json({ done: true });
      }

      const details =
        "bounce" in event.data
          ? event.data.bounce
          : "failed" in event.data
            ? event.data.failed
            : "suppressed" in event.data
              ? event.data.suppressed
              : null;

      await recordEmailDeliveryEvent(
        "resend",
        event.data.email_id,
        eventType,
        event.data.to,
        new Date(event.created_at),
        details,
        svixId,
      );

      if (
        event.type === "email.bounced" &&
        event.data.bounce.type.toLowerCase() === "permanent"
      ) {
        await suppressBouncedEmails(event.data.to);
      } else if (event.type === "email.suppressed") {
        await suppressBouncedEmails(event.data.to);
      } else if (event.type === "email.complained") {
        await suppressComplainedEmails(event.data.to);
      }

      return res.status(200).json({ done: true });
    } catch (error) {
      log_error(error);
      return res.status(500).json({ done: false, message: "Webhook processing failed." });
    }
  }
}
