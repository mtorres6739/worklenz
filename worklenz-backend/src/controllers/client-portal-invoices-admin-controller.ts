import { Response } from "express";

import db from "../config/db";
import { IWorkLenzRequest } from "../interfaces/worklenz-request";
import { ServerResponse } from "../models/server-response";
import { auditPortalEvent } from "../services/client-portal-session.service";
import { sendPortalInvoice } from "../services/client-portal-email.service";
import {
  createInvoice,
  generateInvoicePdf,
  getInvoice,
  isInvoiceUuid,
  listInvoices,
  normalizeInvoiceInput,
  updateInvoice,
} from "../services/client-portal-invoice.service";
import { verifyStripeAccount } from "../services/stripe-portal-payment.service";
import { getSelfHostedCapabilities } from "../shared/self-hosted-capabilities";
import { createPresignedViewUrl } from "../shared/storage";
import {
  createClientInvoiceNotifications,
  emitInvoiceEvent,
} from "../services/client-portal-invoice-notifications.service";

function staffActor(req: IWorkLenzRequest) {
  if (!req.user?.id || !req.user?.team_id) {
    throw new Error("Missing staff session scope");
  }
  return {
    userId: req.user.id,
    teamId: req.user.team_id,
  };
}

function pageOptions(req: IWorkLenzRequest) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  return { page, limit };
}

function inputError(res: Response, error: unknown): Response {
  const message =
    error instanceof Error ? error.message : "Invalid invoice request";
  const notFound = message.includes("not found");
  const conflict =
    message.includes("another user") || message.includes("Only draft");
  return res
    .status(notFound ? 404 : conflict ? 409 : 400)
    .send(new ServerResponse(false, null, message));
}

async function deliverInvoice(
  invoiceId: string,
  teamId: string,
): Promise<{ invoice: any; delivered: boolean; alreadySent: boolean }> {
  const client = await db.connect();
  const lockKey = `portal-invoice-delivery:${invoiceId}`;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
    const invoice = await getInvoice(invoiceId, teamId);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "sent" || invoice.status === "overdue") {
      return { invoice, delivered: true, alreadySent: true };
    }
    if (invoice.status !== "draft") {
      throw new Error("Only draft invoices can be sent");
    }
    const recipients = await client.query(
      `SELECT DISTINCT pcu.email::TEXT AS email
         FROM portal_client_memberships pcm
         JOIN portal_client_users pcu ON pcu.id = pcm.client_user_id
        WHERE pcm.team_id = $1::UUID AND pcm.client_id = $2::UUID
          AND pcm.is_active = TRUE AND pcm.accepted_at IS NOT NULL
          AND pcu.status = 'active'`,
      [teamId, invoice.client.id],
    );
    const emails = recipients.rows.map((row) => row.email).filter(Boolean);
    if (!emails.length) {
      throw new Error("Client has no active portal recipient");
    }
    const delivered = await sendPortalInvoice({
      teamId,
      emails,
      clientName: invoice.client.companyName || invoice.client.name,
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      currency: invoice.currency,
      dueDate: invoice.dueDate,
    });
    if (!delivered) throw new Error("Invoice email delivery failed");
    await client.query(
      `UPDATE portal_invoices
          SET status = 'sent', sent_at = CURRENT_TIMESTAMP,
              version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID AND team_id = $2::UUID AND status = 'draft'`,
      [invoiceId, teamId],
    );
    const updatedInvoice = await getInvoice(invoiceId, teamId);
    if (!updatedInvoice) throw new Error("Invoice not found after delivery");
    const event = {
      invoiceId,
      invoiceNumber: updatedInvoice.invoiceNumber,
      teamId,
      clientId: updatedInvoice.client.id,
      eventType: "invoice_sent" as const,
      title: "New invoice",
      message: `Invoice ${updatedInvoice.invoiceNumber} is ready to view.`,
    };
    await createClientInvoiceNotifications(client, event);
    emitInvoiceEvent(event);
    return {
      invoice: updatedInvoice,
      delivered: true,
      alreadySent: false,
    };
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
    } finally {
      client.release();
    }
  }
}

export default class ClientPortalInvoicesAdminController {
  public static async paymentSettings(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const result = await db.query(
      `SELECT manual_enabled, manual_instructions, stripe_enabled,
              default_payment_terms_days, updated_at
         FROM portal_payment_settings
        WHERE team_id = $1::UUID`,
      [staff.teamId],
    );
    return res.send(
      new ServerResponse(
        true,
        result.rows[0] || {
          manual_enabled: false,
          manual_instructions: null,
          stripe_enabled: false,
          default_payment_terms_days: 14,
        },
      ),
    );
  }

  public static async updatePaymentSettings(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const manualEnabled = req.body?.manual_enabled === true;
    const stripeEnabled = req.body?.stripe_enabled === true;
    const instructions = String(req.body?.manual_instructions || "").trim();
    const terms = Number(req.body?.default_payment_terms_days ?? 14);
    if (
      instructions.length > 5000 ||
      !Number.isInteger(terms) ||
      terms < 0 ||
      terms > 365
    ) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid payment settings"));
    }
    if (manualEnabled && !instructions) {
      return res.status(400).send(
        new ServerResponse(
          false,
          null,
          "Manual payment instructions are required when enabled",
        ),
      );
    }
    if (stripeEnabled) {
      if (!getSelfHostedCapabilities().capabilities.stripeCheckout) {
        return res
          .status(409)
          .send(new ServerResponse(false, null, "Stripe Checkout is not released"));
      }
      try {
        await verifyStripeAccount();
      } catch {
        return res.status(409).send(
          new ServerResponse(
            false,
            null,
            "Stripe account verification failed",
          ),
        );
      }
    }
    const result = await db.query(
      `INSERT INTO portal_payment_settings
         (team_id, manual_enabled, manual_instructions, stripe_enabled,
          default_payment_terms_days, updated_by_user_id)
       VALUES ($1::UUID, $2, $3, $4, $5, $6::UUID)
       ON CONFLICT (team_id) DO UPDATE
         SET manual_enabled = EXCLUDED.manual_enabled,
             manual_instructions = EXCLUDED.manual_instructions,
             stripe_enabled = EXCLUDED.stripe_enabled,
             default_payment_terms_days = EXCLUDED.default_payment_terms_days,
             updated_by_user_id = EXCLUDED.updated_by_user_id,
             updated_at = CURRENT_TIMESTAMP
       RETURNING manual_enabled, manual_instructions, stripe_enabled,
                 default_payment_terms_days, updated_at`,
      [
        staff.teamId,
        manualEnabled,
        manualEnabled ? instructions : null,
        stripeEnabled,
        terms,
        staff.userId,
      ],
    );
    await auditPortalEvent({
      action: "invoice.payment_settings_updated",
      staffUserId: staff.userId,
      teamId: staff.teamId,
      details: { manualEnabled, stripeEnabled, terms },
      req,
    });
    return res.send(
      new ServerResponse(true, result.rows[0], "Payment settings updated"),
    );
  }

  public static async list(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const pagination = pageOptions(req);
    const result = await listInvoices({
      teamId: staff.teamId,
      ...pagination,
      status: String(req.query.status || "") || null,
      search: String(req.query.search || ""),
    });
    return res.send(new ServerResponse(true, result));
  }

  public static async create(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    try {
      const input = normalizeInvoiceInput(req.body || {});
      const created = await createInvoice({
        teamId: staff.teamId,
        userId: staff.userId,
        invoice: input,
      });
      if (created.requestedStatus === "sent") {
        await deliverInvoice(created.id, staff.teamId);
      }
      const invoice = await getInvoice(created.id, staff.teamId);
      await auditPortalEvent({
        action: input.status === "sent" ? "invoice.created_and_sent" : "invoice.created",
        staffUserId: staff.userId,
        teamId: staff.teamId,
        clientId: invoice?.client.id,
        details: { invoiceId: created.id },
        req,
      });
      return res
        .status(201)
        .send(new ServerResponse(true, invoice, "Invoice created"));
    } catch (error) {
      return inputError(res, error);
    }
  }

  public static async details(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const invoice = await getInvoice(String(req.params.id || ""), staff.teamId);
    if (!invoice) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Invoice not found"));
    }
    const payments = await db.query(
      `SELECT pip.id, pip.provider, pip.status, pip.amount, pip.currency,
              pip.refunded_amount,
              pip.submitted_by_name, pip.submitted_by_email,
              pip.provider_reference, pip.created_at, pip.succeeded_at,
              CASE WHEN ppe.id IS NOT NULL THEN jsonb_build_object(
                'id', ppe.id, 'fileName', ppe.file_name, 'mimeType', ppe.mime_type,
                'size', ppe.size, 'status', ppe.status,
                'reviewNote', ppe.review_note, 'createdAt', ppe.created_at
              ) END AS evidence
         FROM portal_invoice_payments pip
         LEFT JOIN portal_payment_evidence ppe ON ppe.payment_id = pip.id
        WHERE pip.invoice_id = $1::UUID AND pip.team_id = $2::UUID
        ORDER BY pip.created_at DESC`,
      [invoice.id, staff.teamId],
    );
    return res.send(
      new ServerResponse(true, { ...invoice, payments: payments.rows }),
    );
  }

  public static async byRequest(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const requestId = String(req.params.requestId || "");
    if (!isInvoiceUuid(requestId)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid request"));
    }
    const result = await db.query(
      `SELECT id FROM portal_invoices
        WHERE request_id = $1::UUID AND team_id = $2::UUID
        ORDER BY created_at DESC`,
      [requestId, staff.teamId],
    );
    const invoices = (
      await Promise.all(
        result.rows.map((row) => getInvoice(row.id, staff.teamId)),
      )
    ).filter(Boolean);
    return res.send(
      new ServerResponse(true, { invoices, count: invoices.length }),
    );
  }

  public static async update(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const id = String(req.params.id || "");
    if (!isInvoiceUuid(id)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid invoice"));
    }
    try {
      const input = normalizeInvoiceInput(req.body || {});
      await updateInvoice({ id, teamId: staff.teamId, invoice: input });
      await auditPortalEvent({
        action: "invoice.updated",
        staffUserId: staff.userId,
        teamId: staff.teamId,
        details: { invoiceId: id },
        req,
      });
      return res.send(
        new ServerResponse(
          true,
          await getInvoice(id, staff.teamId),
          "Invoice updated",
        ),
      );
    } catch (error) {
      return inputError(res, error);
    }
  }

  public static async send(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const id = String(req.params.id || "");
    if (!isInvoiceUuid(id)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid invoice"));
    }
    try {
      const result = await deliverInvoice(id, staff.teamId);
      await auditPortalEvent({
        action: result.alreadySent ? "invoice.send_idempotent" : "invoice.sent",
        staffUserId: staff.userId,
        teamId: staff.teamId,
        clientId: result.invoice.client.id,
        details: { invoiceId: id },
        req,
      });
      return res.send(
        new ServerResponse(true, result.invoice, "Invoice sent"),
      );
    } catch (error) {
      return inputError(res, error);
    }
  }

  public static async markPaid(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const id = String(req.params.id || "");
    const reference = String(req.body?.reference || "").trim();
    const note = String(req.body?.note || "").trim();
    if (!isInvoiceUuid(id) || !reference || reference.length > 255 || note.length > 2000) {
      return res.status(400).send(
        new ServerResponse(
          false,
          null,
          "A valid invoice and payment reference are required",
        ),
      );
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const invoice = await client.query(
        `SELECT id, client_id, amount, currency, status
           FROM portal_invoices
          WHERE id = $1::UUID AND team_id = $2::UUID
          FOR UPDATE`,
        [id, staff.teamId],
      );
      if (!invoice.rowCount) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .send(new ServerResponse(false, null, "Invoice not found"));
      }
      if (invoice.rows[0].status === "paid") {
        await client.query("COMMIT");
        return res.send(
          new ServerResponse(true, await getInvoice(id, staff.teamId)),
        );
      }
      if (invoice.rows[0].status === "draft" || invoice.rows[0].status === "cancelled") {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .send(new ServerResponse(false, null, "Invoice cannot be marked paid"));
      }
      const activePayment = await client.query(
        `SELECT 1 FROM portal_invoice_payments
          WHERE invoice_id = $1::UUID AND team_id = $2::UUID
            AND status IN (
              'checkout_pending',
              'pending_review',
              'processing',
              'succeeded'
            )
          LIMIT 1`,
        [id, staff.teamId],
      );
      if (activePayment.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).send(
          new ServerResponse(
            false,
            null,
            "A payment is already pending or recorded for this invoice",
          ),
        );
      }
      await client.query(
        `INSERT INTO portal_invoice_payments
           (invoice_id, team_id, client_id, submitted_by_name, provider, status,
            amount, currency, idempotency_key, provider_reference, succeeded_at)
         VALUES ($1::UUID, $2::UUID, $3::UUID, $4, 'manual', 'succeeded',
                 $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
        [
          id,
          staff.teamId,
          invoice.rows[0].client_id,
          req.user?.name || "SDM team",
          invoice.rows[0].amount,
          invoice.rows[0].currency,
          `admin:${id}:${reference.toLowerCase()}`,
          reference,
        ],
      );
      await client.query(
        `UPDATE portal_invoices
            SET status = 'paid', paid_at = CURRENT_TIMESTAMP,
                version = version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::UUID AND team_id = $2::UUID`,
        [id, staff.teamId],
      );
      await client.query("COMMIT");
      const paidInvoice = await getInvoice(id, staff.teamId);
      if (paidInvoice) {
        const event = {
          invoiceId: id,
          invoiceNumber: paidInvoice.invoiceNumber,
          teamId: staff.teamId,
          clientId: invoice.rows[0].client_id,
          eventType: "invoice_paid" as const,
          title: "Payment recorded",
          message: `Payment for ${paidInvoice.invoiceNumber} was recorded.`,
        };
        await createClientInvoiceNotifications(db, event);
        emitInvoiceEvent(event);
      }
      await auditPortalEvent({
        action: "invoice.manual_payment_recorded",
        staffUserId: staff.userId,
        teamId: staff.teamId,
        clientId: invoice.rows[0].client_id,
        details: { invoiceId: id, reference, note: note || undefined },
        req,
      });
      return res.send(
        new ServerResponse(
          true,
          await getInvoice(id, staff.teamId),
          "Payment recorded",
        ),
      );
    } catch (error: any) {
      await client.query("ROLLBACK");
      if (error?.code === "23505") {
        return res.status(409).send(
          new ServerResponse(
            false,
            null,
            "A payment is already pending or recorded for this invoice",
          ),
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public static async cancel(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const id = String(req.params.id || "");
    if (!isInvoiceUuid(id)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid invoice"));
    }
    const result = await db.query(
      `UPDATE portal_invoices
          SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP,
              version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID AND team_id = $2::UUID
          AND status IN ('draft', 'sent', 'overdue')
        RETURNING client_id`,
      [id, staff.teamId],
    );
    if (!result.rowCount) {
      return res
        .status(409)
        .send(new ServerResponse(false, null, "Invoice cannot be cancelled"));
    }
    await auditPortalEvent({
      action: "invoice.cancelled",
      staffUserId: staff.userId,
      teamId: staff.teamId,
      clientId: result.rows[0].client_id,
      details: { invoiceId: id },
      req,
    });
    return res.send(new ServerResponse(true, { id }, "Invoice cancelled"));
  }

  public static async download(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const invoice = await getInvoice(String(req.params.id || ""), staff.teamId);
    if (!invoice) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Invoice not found"));
    }
    const pdf = await generateInvoicePdf(invoice);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${invoice.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(pdf);
  }

  public static async downloadEvidence(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const invoiceId = String(req.params.id || "");
    const evidenceId = String(req.params.evidenceId || "");
    if (!isInvoiceUuid(invoiceId) || !isInvoiceUuid(evidenceId)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid payment evidence"));
    }
    const result = await db.query(
      `SELECT object_key, file_name
         FROM portal_payment_evidence
        WHERE id = $1::UUID AND invoice_id = $2::UUID AND team_id = $3::UUID`,
      [evidenceId, invoiceId, staff.teamId],
    );
    if (!result.rowCount) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Payment evidence not found"));
    }
    const url = await createPresignedViewUrl(
      result.rows[0].object_key,
      result.rows[0].file_name,
      300,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.redirect(303, url);
    return res;
  }

  public static async reviewEvidence(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const invoiceId = String(req.params.id || "");
    const evidenceId = String(req.params.evidenceId || "");
    const decision = String(req.body?.decision || "");
    const note = String(req.body?.note || "").trim();
    if (
      !isInvoiceUuid(invoiceId) ||
      !isInvoiceUuid(evidenceId) ||
      !["accept", "reject"].includes(decision) ||
      note.length > 2000
    ) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid evidence review"));
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const evidence = await client.query(
        `SELECT ppe.*, pip.status AS payment_status
           FROM portal_payment_evidence ppe
           JOIN portal_invoice_payments pip
             ON pip.id = ppe.payment_id AND pip.invoice_id = ppe.invoice_id
            AND pip.team_id = ppe.team_id AND pip.client_id = ppe.client_id
          WHERE ppe.id = $1::UUID AND ppe.invoice_id = $2::UUID
            AND ppe.team_id = $3::UUID
          FOR UPDATE OF ppe, pip`,
        [evidenceId, invoiceId, staff.teamId],
      );
      if (!evidence.rowCount) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .send(new ServerResponse(false, null, "Payment evidence not found"));
      }
      if (evidence.rows[0].status !== "submitted") {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .send(new ServerResponse(false, null, "Evidence was already reviewed"));
      }
      const accepted = decision === "accept";
      if (accepted) {
        const otherPayment = await client.query(
          `SELECT 1 FROM portal_invoice_payments
            WHERE invoice_id = $1::UUID AND team_id = $2::UUID
              AND id <> $3::UUID
              AND status IN ('checkout_pending', 'processing', 'succeeded')
            LIMIT 1`,
          [invoiceId, staff.teamId, evidence.rows[0].payment_id],
        );
        if (otherPayment.rowCount) {
          await client.query("ROLLBACK");
          return res.status(409).send(
            new ServerResponse(
              false,
              null,
              "A card payment is already pending or recorded for this invoice",
            ),
          );
        }
      }
      await client.query(
        `UPDATE portal_payment_evidence
            SET status = $2, review_note = $3, reviewed_by_user_id = $4::UUID,
                reviewed_at = CURRENT_TIMESTAMP
          WHERE id = $1::UUID`,
        [
          evidenceId,
          accepted ? "accepted" : "rejected",
          note || null,
          staff.userId,
        ],
      );
      await client.query(
        `UPDATE portal_invoice_payments
            SET status = $2,
                succeeded_at = CASE WHEN $2 = 'succeeded'
                  THEN CURRENT_TIMESTAMP ELSE succeeded_at END,
                failed_at = CASE WHEN $2 = 'failed'
                  THEN CURRENT_TIMESTAMP ELSE failed_at END,
                failure_code = CASE WHEN $2 = 'failed'
                  THEN 'manual_evidence_rejected' ELSE NULL END,
                failure_message = CASE WHEN $2 = 'failed' THEN $3 ELSE NULL END,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::UUID`,
        [
          evidence.rows[0].payment_id,
          accepted ? "succeeded" : "failed",
          note || "Manual payment evidence rejected",
        ],
      );
      await client.query(
        accepted
          ? `UPDATE portal_invoices
                SET status = 'paid', paid_at = CURRENT_TIMESTAMP,
                    version = version + 1, updated_at = CURRENT_TIMESTAMP
              WHERE id = $1::UUID AND team_id = $2::UUID`
          : `UPDATE portal_invoices
                SET status = 'sent', updated_at = CURRENT_TIMESTAMP
              WHERE id = $1::UUID AND team_id = $2::UUID
                AND status = 'payment_pending'`,
        [invoiceId, staff.teamId],
      );
      await client.query("COMMIT");
      const reviewedInvoice = await getInvoice(invoiceId, staff.teamId);
      if (reviewedInvoice) {
        const event = {
          invoiceId,
          invoiceNumber: reviewedInvoice.invoiceNumber,
          teamId: staff.teamId,
          clientId: evidence.rows[0].client_id,
          eventType: accepted
            ? ("invoice_paid" as const)
            : ("invoice_payment_failed" as const),
          title: accepted ? "Payment accepted" : "Payment evidence rejected",
          message: accepted
            ? `Payment for ${reviewedInvoice.invoiceNumber} was accepted.`
            : `Payment evidence for ${reviewedInvoice.invoiceNumber} needs attention.`,
        };
        await createClientInvoiceNotifications(db, event);
        emitInvoiceEvent(event);
      }
      await auditPortalEvent({
        action: accepted
          ? "invoice.payment_evidence_accepted"
          : "invoice.payment_evidence_rejected",
        staffUserId: staff.userId,
        teamId: staff.teamId,
        clientId: evidence.rows[0].client_id,
        details: { invoiceId, evidenceId },
        req,
      });
      return res.send(
        new ServerResponse(
          true,
          await getInvoice(invoiceId, staff.teamId),
          accepted ? "Payment accepted" : "Payment evidence rejected",
        ),
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
