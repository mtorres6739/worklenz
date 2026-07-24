import { Response } from "express";
import crypto from "crypto";

import db from "../config/db";
import { ClientPortalRequest } from "../interfaces/client-portal-request";
import { ServerResponse } from "../models/server-response";
import {
  generateInvoicePdf,
  getInvoice,
  listInvoices,
} from "../services/client-portal-invoice.service";
import { createInvoiceCheckout } from "../services/stripe-portal-payment.service";
import { scanPortalAttachment } from "../services/malware-scanner.service";
import {
  deleteObject,
  getClientPortalStorageKey,
  uploadBuffer,
} from "../shared/storage";
import {
  createStaffInvoiceNotifications,
  emitInvoiceEvent,
} from "../services/client-portal-invoice-notifications.service";

function actor(req: ClientPortalRequest) {
  if (!req.portalActor) throw new Error("Missing client portal scope");
  return req.portalActor;
}

export default class ClientPortalInvoicesController {
  public static async list(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const portalActor = actor(req);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const result = await listInvoices({
      teamId: portalActor.teamId,
      clientId: portalActor.clientId,
      page,
      limit,
      status: String(req.query.status || "") || null,
      search: String(req.query.search || ""),
      excludeDraft: true,
    });
    return res.send(new ServerResponse(true, result));
  }

  public static async details(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const portalActor = actor(req);
    const invoice = await getInvoice(
      String(req.params.id || ""),
      portalActor.teamId,
      portalActor.clientId,
    );
    if (!invoice || invoice.status === "draft") {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Invoice not found"));
    }
    const payments = await db.query(
      `SELECT provider, status, amount, currency, refunded_amount,
              provider_reference,
              succeeded_at, failed_at, refunded_at, created_at
         FROM portal_invoice_payments
        WHERE invoice_id = $1::UUID AND team_id = $2::UUID
          AND client_id = $3::UUID
        ORDER BY created_at DESC`,
      [invoice.id, portalActor.teamId, portalActor.clientId],
    );
    return res.send(
      new ServerResponse(true, { ...invoice, payments: payments.rows }),
    );
  }

  public static async paymentSettings(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const portalActor = actor(req);
    const result = await db.query(
      `SELECT manual_enabled, manual_instructions, stripe_enabled
         FROM portal_payment_settings
        WHERE team_id = $1::UUID`,
      [portalActor.teamId],
    );
    const row = result.rows[0] || {};
    return res.send(
      new ServerResponse(true, {
        manualEnabled: row.manual_enabled === true,
        manualInstructions: row.manual_enabled
          ? row.manual_instructions || null
          : null,
        stripeEnabled: row.stripe_enabled === true,
      }),
    );
  }

  public static async createCheckout(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const portalActor = actor(req);
    try {
      const result = await createInvoiceCheckout({
        actor: portalActor,
        invoiceId: String(req.params.id || ""),
        req,
      });
      return res.send(new ServerResponse(true, result));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to create checkout";
      const notFound = message === "Invoice not found";
      const conflict =
        message.includes("paid") ||
        message.includes("not enabled") ||
        message.includes("processing") ||
        message.includes("pending") ||
        message.includes("under review") ||
        message.includes("being prepared");
      return res
        .status(notFound ? 404 : conflict ? 409 : 400)
        .send(new ServerResponse(false, null, message));
    }
  }

  public static async submitPaymentEvidence(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const portalActor = actor(req);
    const invoice = await getInvoice(
      String(req.params.id || ""),
      portalActor.teamId,
      portalActor.clientId,
    );
    if (
      !invoice ||
      invoice.status === "draft" ||
      invoice.status === "cancelled" ||
      invoice.status === "paid"
    ) {
      return res
        .status(409)
        .send(new ServerResponse(false, null, "Invoice cannot accept payment evidence"));
    }
    const settings = await db.query(
      `SELECT manual_enabled FROM portal_payment_settings
        WHERE team_id = $1::UUID`,
      [portalActor.teamId],
    );
    if (settings.rows[0]?.manual_enabled !== true) {
      return res
        .status(409)
        .send(new ServerResponse(false, null, "Manual payments are not enabled"));
    }
    if (!req.file || !req.portalRequestFileMeta) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Payment evidence is required"));
    }
    const scan = await scanPortalAttachment(req.file.buffer);
    if (scan.status !== "clean") {
      return res
        .status(scan.status === "infected" ? 400 : 503)
        .send(
          new ServerResponse(
            false,
            null,
            scan.status === "infected"
              ? "Payment evidence failed the security scan"
              : "Payment evidence scanning is unavailable",
          ),
        );
    }
    const evidenceId = crypto.randomUUID();
    const objectKey = getClientPortalStorageKey(
      "payment-proofs",
      portalActor.teamId,
      portalActor.clientId,
      invoice.id,
      `${evidenceId}.${req.portalRequestFileMeta.extension}`,
    );
    const uploaded = await uploadBuffer(
      req.file.buffer,
      req.portalRequestFileMeta.mimeType,
      objectKey,
    );
    if (!uploaded) {
      return res
        .status(503)
        .send(new ServerResponse(false, null, "Unable to store payment evidence"));
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT status FROM portal_invoices
          WHERE id = $1::UUID AND team_id = $2::UUID AND client_id = $3::UUID
          FOR UPDATE`,
        [invoice.id, portalActor.teamId, portalActor.clientId],
      );
      if (
        !locked.rowCount ||
        ["draft", "cancelled", "paid"].includes(locked.rows[0].status)
      ) {
        throw new Error("Invoice cannot accept payment evidence");
      }
      const pending = await client.query(
        `SELECT 1 FROM portal_invoice_payments
          WHERE invoice_id = $1::UUID AND team_id = $2::UUID
            AND client_id = $3::UUID
            AND status IN (
              'checkout_pending',
              'pending_review',
              'processing',
              'succeeded'
            )
          LIMIT 1`,
        [invoice.id, portalActor.teamId, portalActor.clientId],
      );
      if (pending.rowCount) throw new Error("A payment is already under review");
      const payment = await client.query(
        `INSERT INTO portal_invoice_payments
           (invoice_id, team_id, client_id, submitted_by_membership_id,
            submitted_by_name, submitted_by_email, provider, status, amount,
            currency, idempotency_key)
         VALUES ($1::UUID, $2::UUID, $3::UUID, $4::UUID, $5, $6, 'manual',
                 'pending_review', $7, $8, $9)
         RETURNING id`,
        [
          invoice.id,
          portalActor.teamId,
          portalActor.clientId,
          portalActor.membershipId,
          portalActor.name,
          portalActor.email,
          invoice.amount,
          invoice.currency,
          `evidence:${evidenceId}`,
        ],
      );
      await client.query(
        `INSERT INTO portal_payment_evidence
           (id, payment_id, invoice_id, team_id, client_id,
            submitted_by_membership_id, object_key, file_name, mime_type, size)
         VALUES ($1::UUID, $2::UUID, $3::UUID, $4::UUID, $5::UUID, $6::UUID,
                 $7, $8, $9, $10)`,
        [
          evidenceId,
          payment.rows[0].id,
          invoice.id,
          portalActor.teamId,
          portalActor.clientId,
          objectKey,
          req.portalRequestFileMeta.cleanFileName,
          req.portalRequestFileMeta.mimeType,
          req.file.size,
        ],
      );
      await client.query(
        `UPDATE portal_invoices
            SET status = 'payment_pending', updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::UUID`,
        [invoice.id],
      );
      await client.query("COMMIT");
      const event = {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        teamId: portalActor.teamId,
        clientId: portalActor.clientId,
        eventType: "invoice_payment_pending" as const,
        title: "Payment evidence submitted",
        message: `${portalActor.name} submitted payment evidence for ${invoice.invoiceNumber}.`,
      };
      const staffUsers = await createStaffInvoiceNotifications(db, event);
      emitInvoiceEvent(event, staffUsers);
      return res.status(201).send(
        new ServerResponse(
          true,
          { id: evidenceId, status: "submitted" },
          "Payment evidence submitted",
        ),
      );
    } catch (error: any) {
      await client.query("ROLLBACK");
      await deleteObject(objectKey);
      const message =
        error?.code === "23505"
          ? "A payment is already pending or recorded"
          : error instanceof Error
            ? error.message
            : "Unable to submit payment evidence";
      return res.status(409).send(new ServerResponse(false, null, message));
    } finally {
      client.release();
    }
  }

  public static async download(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const portalActor = actor(req);
    const invoice = await getInvoice(
      String(req.params.id || ""),
      portalActor.teamId,
      portalActor.clientId,
    );
    if (!invoice || invoice.status === "draft") {
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
}
