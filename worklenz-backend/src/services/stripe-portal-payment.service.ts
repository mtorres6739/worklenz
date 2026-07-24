import crypto from "crypto";
import { Request } from "express";
import Stripe from "stripe";

import db from "../config/db";
import { ClientPortalActor } from "../interfaces/client-portal-request";
import { getSelfHostedCapabilities } from "../shared/self-hosted-capabilities";
import { auditPortalEvent } from "./client-portal-session.service";
import { getInvoice } from "./client-portal-invoice.service";
import {
  createClientInvoiceNotifications,
  createStaffInvoiceNotifications,
  emitInvoiceEvent,
  InvoiceEvent,
} from "./client-portal-invoice-notifications.service";

let stripeClient: Stripe | null = null;
let verifiedAccountId: string | null = null;

function stripe(): Stripe {
  if (!getSelfHostedCapabilities().capabilities.stripeCheckout) {
    throw new Error("Stripe Checkout is not enabled");
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured");
  if (key.startsWith("sk_live_") && process.env.STRIPE_ALLOW_LIVE_PAYMENTS !== "true") {
    throw new Error("Live Stripe payments are not authorized");
  }
  stripeClient ||= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
  return stripeClient;
}

export async function verifyStripeAccount(): Promise<string> {
  const expected = process.env.STRIPE_EXPECTED_ACCOUNT_ID;
  if (!expected) throw new Error("Expected Stripe account is not configured");
  if (verifiedAccountId === expected) return expected;
  const account = await stripe().accounts.retrieveCurrent();
  if (account.id !== expected) {
    throw new Error("Configured Stripe key belongs to an unexpected account");
  }
  verifiedAccountId = account.id;
  return account.id;
}

export function constructStripeWebhookEvent(
  rawBody: Buffer,
  signature: string,
  webhookSecret: string,
  client: Stripe = stripe(),
): Stripe.Event {
  return client.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

function appOrigin() {
  return (process.env.APP_ORIGIN || process.env.FRONTEND_URL || "").replace(
    /\/+$/,
    "",
  );
}

export async function createInvoiceCheckout(input: {
  actor: ClientPortalActor;
  invoiceId: string;
  req: Request;
}) {
  await verifyStripeAccount();
  const invoice = await getInvoice(
    input.invoiceId,
    input.actor.teamId,
    input.actor.clientId,
  );
  if (!invoice || invoice.status === "draft" || invoice.status === "cancelled") {
    throw new Error("Invoice not found");
  }
  if (invoice.status === "paid") throw new Error("Invoice is already paid");
  const settings = await db.query(
    `SELECT stripe_enabled
       FROM portal_payment_settings
      WHERE team_id = $1::UUID`,
    [input.actor.teamId],
  );
  if (settings.rows[0]?.stripe_enabled !== true) {
    throw new Error("Card payments are not enabled for this organization");
  }
  const origin = appOrigin();
  if (!origin) throw new Error("Application origin is not configured");

  const activePayment = await db.query(
    `SELECT id, provider, status, checkout_session_id, idempotency_key,
            submitted_by_email
       FROM portal_invoice_payments
      WHERE invoice_id = $1::UUID AND team_id = $2::UUID
        AND client_id = $3::UUID
        AND status IN (
          'checkout_pending',
          'pending_review',
          'processing',
          'succeeded'
        )
      ORDER BY created_at DESC
      LIMIT 1`,
    [invoice.id, input.actor.teamId, input.actor.clientId],
  );
  let reusablePayment: any = null;
  if (activePayment.rowCount) {
    const existingPayment = activePayment.rows[0];
    if (existingPayment.provider !== "stripe") {
      throw new Error("A manual payment is already under review");
    }
    if (existingPayment.status === "succeeded") {
      throw new Error("Invoice is already paid");
    }
    if (existingPayment.status === "processing") {
      throw new Error("Invoice payment is already processing");
    }
    if (!existingPayment.checkout_session_id) {
      reusablePayment = existingPayment;
    } else {
      const existing = await stripe().checkout.sessions.retrieve(
        existingPayment.checkout_session_id,
      );
      if (existing.status === "open" && existing.url) {
        return { checkoutUrl: existing.url, sessionId: existing.id };
      }
      if (existing.status === "complete" || existing.payment_status === "paid") {
        throw new Error("Invoice payment is already processing");
      }
      await db.query(
        `UPDATE portal_invoice_payments
            SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::UUID AND team_id = $2::UUID
            AND status = 'checkout_pending'`,
        [existingPayment.id, input.actor.teamId],
      );
    }
  }

  const idempotencyKey =
    reusablePayment?.idempotency_key ||
    [
      "checkout",
      invoice.id,
      invoice.version,
      input.actor.membershipId,
      crypto.randomUUID(),
    ].join(":");
  const payment = reusablePayment
    ? { rows: [reusablePayment] }
    : await db
      .query(
        `INSERT INTO portal_invoice_payments
       (invoice_id, team_id, client_id, submitted_by_membership_id,
        submitted_by_name, submitted_by_email, provider, status, amount,
        currency, idempotency_key)
     VALUES ($1::UUID, $2::UUID, $3::UUID, $4::UUID, $5, $6,
             'stripe', 'checkout_pending', $7, $8, $9)
     RETURNING *`,
      [
        invoice.id,
        input.actor.teamId,
        input.actor.clientId,
        input.actor.membershipId,
        input.actor.name,
        input.actor.email,
        invoice.amount,
        invoice.currency,
        idempotencyKey,
      ],
      )
      .catch((error: any) => {
        if (error?.code === "23505") {
          throw new Error("A payment is already pending or recorded");
        }
        throw error;
      });
  const checkoutEmail =
    payment.rows[0].submitted_by_email || input.actor.email;
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: invoice.id,
        customer_email: checkoutEmail,
        success_url: `${origin}/client-portal/invoices/${invoice.id}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/client-portal/invoices/${invoice.id}?payment=cancelled`,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: invoice.currency.toLowerCase(),
              unit_amount: Math.round(invoice.amount * 100),
              product_data: {
                name: `Invoice ${invoice.invoiceNumber}`,
                description: invoice.client.companyName || invoice.client.name,
              },
            },
          },
        ],
        metadata: {
          invoice_id: invoice.id,
          team_id: input.actor.teamId,
          client_id: input.actor.clientId,
          payment_id: payment.rows[0].id,
        },
        payment_intent_data: {
          metadata: {
            invoice_id: invoice.id,
            team_id: input.actor.teamId,
            client_id: input.actor.clientId,
            payment_id: payment.rows[0].id,
          },
        },
      },
      { idempotencyKey },
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
  } catch (error: any) {
    await db.query(
      `UPDATE portal_invoice_payments
          SET status = 'failed', failure_code = $3, failure_message = $4,
              failed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID AND team_id = $2::UUID`,
      [
        payment.rows[0].id,
        input.actor.teamId,
        String(error?.code || "checkout_create_failed").slice(0, 120),
        String(error?.message || "Checkout creation failed").slice(0, 1000),
      ],
    );
    await db.query(
      `UPDATE portal_invoices pi
          SET status = 'sent', updated_at = CURRENT_TIMESTAMP
        WHERE pi.id = $1::UUID AND pi.team_id = $2::UUID
          AND pi.status = 'payment_pending'
          AND NOT EXISTS (
            SELECT 1
              FROM portal_invoice_payments pip
             WHERE pip.invoice_id = pi.id AND pip.team_id = pi.team_id
               AND pip.client_id = pi.client_id
               AND pip.status IN (
                 'checkout_pending',
                 'pending_review',
                 'processing',
                 'succeeded'
               )
          )`,
      [invoice.id, input.actor.teamId],
    );
    throw error;
  }
  await db.query(
    `UPDATE portal_invoice_payments
        SET checkout_session_id = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::UUID AND team_id = $2::UUID`,
    [payment.rows[0].id, input.actor.teamId, session.id],
  );
  await db.query(
    `UPDATE portal_invoices
        SET status = 'payment_pending', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::UUID AND team_id = $2::UUID
        AND status IN ('sent', 'overdue')`,
    [invoice.id, input.actor.teamId],
  );
  await auditPortalEvent({
    action: "invoice.checkout_created",
    actor: input.actor,
    details: { invoiceId: invoice.id, paymentId: payment.rows[0].id },
    req: input.req,
  });
  return { checkoutUrl: session.url, sessionId: session.id };
}

function cents(value: unknown): number {
  return Math.round(Number(value || 0) * 100);
}

async function processCheckoutEvent(
  client: any,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<{
  outcome: "processed" | "ignored";
  event?: InvoiceEvent;
  staffUserIds?: string[];
}> {
  const metadata = session.metadata || {};
  const payment = await client.query(
    `SELECT pip.*, pi.status AS invoice_status, pi.invoice_no
       FROM portal_invoice_payments pip
       JOIN portal_invoices pi
         ON pi.id = pip.invoice_id AND pi.team_id = pip.team_id
        AND pi.client_id = pip.client_id
      WHERE pip.checkout_session_id = $1
         OR (
           pip.id = $2::UUID
           AND pip.invoice_id = $3::UUID
           AND pip.team_id = $4::UUID
           AND pip.client_id = $5::UUID
         )
      FOR UPDATE OF pip, pi`,
    [
      session.id,
      metadata.payment_id || null,
      metadata.invoice_id || null,
      metadata.team_id || null,
      metadata.client_id || null,
    ],
  );
  if (!payment.rowCount) return { outcome: "ignored" };
  const row = payment.rows[0];
  if (
    metadata.invoice_id !== row.invoice_id ||
    metadata.team_id !== row.team_id ||
    metadata.client_id !== row.client_id ||
    metadata.payment_id !== row.id ||
    session.currency?.toUpperCase() !== row.currency ||
    Number(session.amount_total) !== cents(row.amount)
  ) {
    throw new Error("Stripe checkout metadata or amount mismatch");
  }

  const failed = event.type === "checkout.session.async_payment_failed";
  const succeeded =
    event.type === "checkout.session.async_payment_succeeded" ||
    (event.type === "checkout.session.completed" &&
      session.payment_status === "paid");
  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
  if (failed) {
    await client.query(
      `UPDATE portal_invoice_payments
          SET status = 'failed', payment_intent_id = COALESCE($2, payment_intent_id),
              checkout_session_id = COALESCE(checkout_session_id, $3),
              failure_code = 'async_payment_failed',
              failure_message = 'Stripe reported an asynchronous payment failure',
              failed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID`,
      [row.id, paymentIntent, session.id],
    );
    await client.query(
      `UPDATE portal_invoices
          SET status = 'sent', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID AND status = 'payment_pending'`,
      [row.invoice_id],
    );
    const event =
      row.status === "failed"
        ? undefined
        : {
            invoiceId: row.invoice_id,
            invoiceNumber: row.invoice_no,
            teamId: row.team_id,
            clientId: row.client_id,
            eventType: "invoice_payment_failed" as const,
            title: "Payment failed",
            message: `Payment for ${row.invoice_no} was not completed.`,
          };
    if (event) await createClientInvoiceNotifications(client, event);
    const staffUserIds = event
      ? await createStaffInvoiceNotifications(client, event)
      : [];
    return { outcome: "processed", event, staffUserIds };
  }
  if (succeeded) {
    await client.query(
      `UPDATE portal_invoice_payments
          SET status = 'succeeded',
              payment_intent_id = COALESCE($2, payment_intent_id),
              checkout_session_id = COALESCE(checkout_session_id, $3),
              succeeded_at = COALESCE(succeeded_at, CURRENT_TIMESTAMP),
              failure_code = NULL, failure_message = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID`,
      [row.id, paymentIntent, session.id],
    );
    await client.query(
      `UPDATE portal_invoices
          SET status = 'paid', paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
              version = version + CASE WHEN status <> 'paid' THEN 1 ELSE 0 END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID`,
      [row.invoice_id],
    );
    const event =
      row.status === "succeeded"
        ? undefined
        : {
            invoiceId: row.invoice_id,
            invoiceNumber: row.invoice_no,
            teamId: row.team_id,
            clientId: row.client_id,
            eventType: "invoice_paid" as const,
            title: "Payment received",
            message: `Payment for ${row.invoice_no} was received.`,
          };
    if (event) await createClientInvoiceNotifications(client, event);
    const staffUserIds = event
      ? await createStaffInvoiceNotifications(client, event)
      : [];
    return { outcome: "processed", event, staffUserIds };
  }
  await client.query(
    `UPDATE portal_invoice_payments
        SET status = 'processing',
            payment_intent_id = COALESCE($2, payment_intent_id),
            checkout_session_id = COALESCE(checkout_session_id, $3),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::UUID`,
    [row.id, paymentIntent, session.id],
  );
  return { outcome: "processed" };
}

async function processIntentFailure(
  client: any,
  intent: Stripe.PaymentIntent,
): Promise<{
  outcome: "processed" | "ignored";
  event?: InvoiceEvent;
  staffUserIds?: string[];
}> {
  const paymentId = intent.metadata?.payment_id || null;
  const payment = await client.query(
    `SELECT pip.*, pi.invoice_no
       FROM portal_invoice_payments pip
       JOIN portal_invoices pi
         ON pi.id = pip.invoice_id AND pi.team_id = pip.team_id
        AND pi.client_id = pip.client_id
      WHERE pip.payment_intent_id = $1
         OR (
           pip.id = $2::UUID
           AND pip.invoice_id = $3::UUID
           AND pip.team_id = $4::UUID
           AND pip.client_id = $5::UUID
         )
      FOR UPDATE`,
    [
      intent.id,
      paymentId,
      intent.metadata?.invoice_id || null,
      intent.metadata?.team_id || null,
      intent.metadata?.client_id || null,
    ],
  );
  if (!payment.rowCount) return { outcome: "ignored" };
  const row = payment.rows[0];
  await client.query(
    `UPDATE portal_invoice_payments
        SET status = 'failed',
            payment_intent_id = COALESCE(payment_intent_id, $2),
            failure_code = $3, failure_message = $4,
            failed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::UUID`,
    [
      row.id,
      intent.id,
      String(intent.last_payment_error?.code || "payment_failed").slice(0, 120),
      String(intent.last_payment_error?.message || "Payment failed").slice(0, 1000),
    ],
  );
  await client.query(
    `UPDATE portal_invoices SET status = 'sent', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::UUID AND status = 'payment_pending'`,
    [row.invoice_id],
  );
  const event =
    row.status === "failed"
      ? undefined
      : {
          invoiceId: row.invoice_id,
          invoiceNumber: row.invoice_no,
          teamId: row.team_id,
          clientId: row.client_id,
          eventType: "invoice_payment_failed" as const,
          title: "Payment failed",
          message: `Payment for ${row.invoice_no} was not completed.`,
        };
  if (event) await createClientInvoiceNotifications(client, event);
  const staffUserIds = event
    ? await createStaffInvoiceNotifications(client, event)
    : [];
  return { outcome: "processed", event, staffUserIds };
}

async function processRefund(
  client: any,
  charge: Stripe.Charge,
): Promise<{
  outcome: "processed" | "ignored";
  event?: InvoiceEvent;
  staffUserIds?: string[];
}> {
  const intentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!intentId || charge.amount_refunded <= 0) {
    return { outcome: "ignored" };
  }
  const payment = await client.query(
    `SELECT pip.*, pi.invoice_no
       FROM portal_invoice_payments pip
       JOIN portal_invoices pi
         ON pi.id = pip.invoice_id AND pi.team_id = pip.team_id
        AND pi.client_id = pip.client_id
      WHERE pip.payment_intent_id = $1
      FOR UPDATE`,
    [intentId],
  );
  if (!payment.rowCount) return { outcome: "ignored" };
  const row = payment.rows[0];
  if (
    charge.currency.toUpperCase() !== row.currency ||
    charge.amount !== cents(row.amount) ||
    charge.amount_refunded > charge.amount
  ) {
    throw new Error("Stripe refund amount or currency mismatch");
  }
  const fullyRefunded = charge.amount_refunded === charge.amount;
  await client.query(
    `UPDATE portal_invoice_payments
        SET status = CASE WHEN $2 THEN 'refunded' ELSE status END,
            refunded_amount = $3,
            refunded_at = CASE WHEN $2
              THEN COALESCE(refunded_at, CURRENT_TIMESTAMP) ELSE refunded_at END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::UUID`,
    [row.id, fullyRefunded, charge.amount_refunded / 100],
  );
  if (!fullyRefunded) return { outcome: "processed" };
  await client.query(
    `UPDATE portal_invoices
        SET status = 'sent', paid_at = NULL, version = version + 1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::UUID AND status = 'paid'`,
    [row.invoice_id],
  );
  const event =
    row.status === "refunded"
      ? undefined
      : {
          invoiceId: row.invoice_id,
          invoiceNumber: row.invoice_no,
          teamId: row.team_id,
          clientId: row.client_id,
          eventType: "invoice_refunded" as const,
          title: "Payment refunded",
          message: `Payment for ${row.invoice_no} was refunded.`,
        };
  if (event) await createClientInvoiceNotifications(client, event);
  const staffUserIds = event
    ? await createStaffInvoiceNotifications(client, event)
    : [];
  return { outcome: "processed", event, staffUserIds };
}

export async function handleStripeWebhook(
  rawBody: Buffer,
  signature: string,
): Promise<"processed" | "ignored"> {
  await verifyStripeAccount();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("Stripe webhook is not configured");
  const event = constructStripeWebhookEvent(
    rawBody,
    signature,
    webhookSecret,
  );
  if (event.livemode && process.env.STRIPE_ALLOW_LIVE_PAYMENTS !== "true") {
    throw new Error("Live Stripe event rejected");
  }
  const hash = crypto.createHash("sha256").update(rawBody).digest("hex");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO portal_payment_webhook_events
         (provider, provider_event_id, event_type, provider_object_id,
          payload_sha256)
       VALUES ('stripe', $1, $2, $3, $4)
       ON CONFLICT (provider, provider_event_id) DO NOTHING`,
      [event.id, event.type, String((event.data.object as any)?.id || ""), hash],
    );
    const receipt = await client.query(
      `SELECT * FROM portal_payment_webhook_events
        WHERE provider = 'stripe' AND provider_event_id = $1
        FOR UPDATE`,
      [event.id],
    );
    if (receipt.rows[0].payload_sha256 !== hash) {
      throw new Error("Duplicate Stripe event payload mismatch");
    }
    if (["processed", "ignored"].includes(receipt.rows[0].status)) {
      await client.query("COMMIT");
      return receipt.rows[0].status;
    }
    await client.query(
      `UPDATE portal_payment_webhook_events
          SET status = 'processing',
              attempt_count = CASE WHEN status = 'failed'
                THEN attempt_count + 1 ELSE attempt_count END,
              error_message = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID`,
      [receipt.rows[0].id],
    );

    let processing: {
      outcome: "processed" | "ignored";
      event?: InvoiceEvent;
      staffUserIds?: string[];
    } = { outcome: "ignored" };
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      processing = await processCheckoutEvent(
        client,
        event,
        event.data.object as Stripe.Checkout.Session,
      );
    } else if (event.type === "payment_intent.payment_failed") {
      processing = await processIntentFailure(
        client,
        event.data.object as Stripe.PaymentIntent,
      );
    } else if (event.type === "charge.refunded") {
      processing = await processRefund(
        client,
        event.data.object as Stripe.Charge,
      );
    }
    await client.query(
      `UPDATE portal_payment_webhook_events
          SET status = $2, processed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID`,
      [receipt.rows[0].id, processing.outcome],
    );
    await client.query("COMMIT");
    if (processing.event) {
      emitInvoiceEvent(processing.event, processing.staffUserIds);
    }
    return processing.outcome;
  } catch (error) {
    await client.query("ROLLBACK");
    await db.query(
      `INSERT INTO portal_payment_webhook_events
         (provider, provider_event_id, event_type, provider_object_id,
          payload_sha256, status, error_message)
       VALUES ('stripe', $1, $2, $3, $4, 'failed', $5)
       ON CONFLICT (provider, provider_event_id) DO UPDATE
         SET status = 'failed',
             error_message = EXCLUDED.error_message,
             updated_at = CURRENT_TIMESTAMP`,
      [
        event.id,
        event.type,
        String((event.data.object as any)?.id || ""),
        hash,
        String((error as Error).message).slice(0, 1000),
      ],
    );
    throw error;
  } finally {
    client.release();
  }
}

export function resetStripeClientForTests() {
  stripeClient = null;
  verifiedAccountId = null;
}
