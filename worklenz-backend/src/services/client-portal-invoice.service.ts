import { PoolClient } from "pg";
import puppeteer from "puppeteer";

import db from "../config/db";
import {
  InvoiceData,
  InvoiceTemplateGenerator,
} from "../shared/invoice-template-generator";
import { createPresignedViewUrl } from "../shared/storage";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVOICE_STATUSES = new Set([
  "draft",
  "sent",
  "payment_pending",
  "paid",
  "overdue",
  "cancelled",
]);

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  rate: number;
}

export interface InvoiceTotals {
  items: Array<InvoiceLineInput & { amount: number }>;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  amount: number;
}

export interface InvoiceWriteInput {
  requestId: string;
  currency: string;
  dueDate: string | null;
  notes: string | null;
  status: "draft" | "sent";
  lineItems: InvoiceLineInput[];
  discountType: "none" | "percentage" | "fixed";
  discountValue: number;
  taxRate: number;
  version?: number;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function money(value: number): number {
  return Math.round(value) / 100;
}

function scaled(value: number, places: number): number {
  return Math.round(value * 10 ** places);
}

export function isInvoiceUuid(value: unknown): boolean {
  return UUID_PATTERN.test(String(value || ""));
}

export function calculateInvoiceTotals(
  inputItems: InvoiceLineInput[],
  discountType: InvoiceWriteInput["discountType"],
  discountValue: number,
  taxRate: number,
): InvoiceTotals {
  if (!Array.isArray(inputItems) || inputItems.length < 1 || inputItems.length > 100) {
    throw new Error("Invoice must contain between 1 and 100 line items");
  }
  const items = inputItems.map((item) => {
    const description = String(item.description || "").trim();
    const quantityMills = scaled(Number(item.quantity), 3);
    const unitCents = cents(Number(item.rate));
    if (
      !description ||
      description.length > 500 ||
      !Number.isSafeInteger(quantityMills) ||
      quantityMills <= 0 ||
      !Number.isSafeInteger(unitCents) ||
      unitCents < 0
    ) {
      throw new Error("Invalid invoice line item");
    }
    const lineCents = Math.round((quantityMills * unitCents) / 1000);
    if (!Number.isSafeInteger(lineCents) || lineCents < 0) {
      throw new Error("Invoice line amount is too large");
    }
    return {
      description,
      quantity: quantityMills / 1000,
      rate: money(unitCents),
      amount: money(lineCents),
    };
  });

  const subtotalCents = items.reduce((sum, item) => sum + cents(item.amount), 0);
  const normalizedDiscount = Number(discountValue || 0);
  const normalizedTaxRate = Number(taxRate || 0);
  if (
    !Number.isFinite(normalizedDiscount) ||
    normalizedDiscount < 0 ||
    !Number.isFinite(normalizedTaxRate) ||
    normalizedTaxRate < 0 ||
    normalizedTaxRate > 100
  ) {
    throw new Error("Invalid invoice tax or discount");
  }

  let discountCents = 0;
  if (discountType === "percentage") {
    if (normalizedDiscount > 100) throw new Error("Percentage discount cannot exceed 100");
    discountCents = Math.round(
      (subtotalCents * scaled(normalizedDiscount, 4)) / 1_000_000,
    );
  } else if (discountType === "fixed") {
    discountCents = cents(normalizedDiscount);
  } else if (discountType !== "none") {
    throw new Error("Invalid discount type");
  }
  if (discountCents > subtotalCents) {
    throw new Error("Discount cannot exceed the subtotal");
  }

  const taxableCents = subtotalCents - discountCents;
  const taxCents = Math.round(
    (taxableCents * scaled(normalizedTaxRate, 4)) / 1_000_000,
  );
  const totalCents = taxableCents + taxCents;
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new Error("Invoice total must be greater than zero");
  }

  return {
    items,
    subtotal: money(subtotalCents),
    discountAmount: money(discountCents),
    taxAmount: money(taxCents),
    amount: money(totalCents),
  };
}

export function normalizeInvoiceInput(body: Record<string, unknown>): InvoiceWriteInput {
  const requestId = String(body.requestId || body.request_id || "");
  const currency = String(body.currency || "USD").trim().toUpperCase();
  const dueDateValue = body.dueDate || body.due_date;
  const dueDate = dueDateValue ? String(dueDateValue) : null;
  const notesValue = String(body.notes || "").trim();
  const status = body.status === "sent" ? "sent" : "draft";
  const discountTypeValue = String(body.discountType || body.discount_type || "none");
  const discountType =
    discountTypeValue === "percentage" || discountTypeValue === "fixed"
      ? discountTypeValue
      : "none";
  const rawItems = Array.isArray(body.lineItems)
    ? body.lineItems
    : Array.isArray(body.items)
      ? body.items
      : [];
  const lineItems = rawItems.map((item: any) => ({
    description: String(item?.description || ""),
    quantity: Number(item?.quantity),
    rate: Number(item?.rate ?? item?.unitAmount ?? item?.unit_amount),
  }));

  if (
    !isInvoiceUuid(requestId) ||
    !/^[A-Z]{3}$/.test(currency) ||
    (dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) ||
    notesValue.length > 10000
  ) {
    throw new Error("Invalid invoice configuration");
  }

  return {
    requestId,
    currency,
    dueDate,
    notes: notesValue || null,
    status,
    lineItems,
    discountType,
    discountValue: Number(body.discountValue ?? body.discount_value ?? 0),
    taxRate: Number(body.taxRate ?? body.tax_rate ?? 0),
    version:
      body.version === undefined ? undefined : Number(body.version),
  };
}

function mapInvoiceRow(row: any) {
  return {
    id: row.id,
    invoiceNumber: row.invoice_no,
    amount: Number(row.amount),
    subtotal: Number(row.subtotal),
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    discountAmount: Number(row.discount_amount),
    taxRate: Number(row.tax_rate),
    taxAmount: Number(row.tax_amount),
    currency: row.currency,
    status: row.status,
    dueDate: row.due_date,
    sentAt: row.sent_at,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    requestNumber: row.request_no,
    serviceName: row.service_name,
    isOverdue:
      row.status !== "paid" &&
      row.status !== "cancelled" &&
      row.due_date &&
      String(row.due_date) < new Date().toISOString().slice(0, 10),
  };
}

export async function listInvoices(input: {
  teamId: string;
  clientId?: string;
  page: number;
  limit: number;
  status?: string | null;
  search?: string;
  excludeDraft?: boolean;
}) {
  const offset = (input.page - 1) * input.limit;
  const status = INVOICE_STATUSES.has(String(input.status))
    ? String(input.status)
    : null;
  const search = String(input.search || "").trim();
  const result = await db.query(
    `SELECT pi.*, pr.request_no, ps.name AS service_name,
            COALESCE(c.company_name, c.name) AS client_name,
            COUNT(*) OVER()::INT AS full_count
       FROM portal_invoices pi
       JOIN clients c ON c.id = pi.client_id AND c.team_id = pi.team_id
       LEFT JOIN portal_requests pr
         ON pr.id = pi.request_id AND pr.team_id = pi.team_id
       LEFT JOIN portal_services ps
         ON ps.id = pr.service_id AND ps.team_id = pr.team_id
      WHERE pi.team_id = $1::UUID
        AND ($2::UUID IS NULL OR pi.client_id = $2::UUID)
        AND ($3::TEXT IS NULL OR pi.status = $3)
        AND ($7::BOOLEAN = FALSE OR pi.status <> 'draft')
        AND ($4 = '' OR pi.invoice_no ILIKE '%' || $4 || '%'
          OR COALESCE(c.company_name, c.name) ILIKE '%' || $4 || '%'
          OR COALESCE(pr.request_no, '') ILIKE '%' || $4 || '%')
      ORDER BY pi.created_at DESC, pi.id
      LIMIT $5 OFFSET $6`,
    [
      input.teamId,
      input.clientId || null,
      status,
      search,
      input.limit,
      offset,
      input.excludeDraft === true,
    ],
  );
  return {
    invoices: result.rows.map(mapInvoiceRow),
    total: result.rows[0]?.full_count || 0,
    page: input.page,
    limit: input.limit,
  };
}

export async function getInvoice(
  invoiceId: string,
  teamId: string,
  clientId?: string,
) {
  if (!isInvoiceUuid(invoiceId)) return null;
  const result = await db.query(
    `SELECT pi.*, pr.request_no, pr.request_data, pr.notes AS request_notes,
            ps.id AS service_id, ps.name AS service_name,
            ps.description AS service_description,
            c.name AS client_name, c.company_name, c.email AS client_email,
            c.phone AS client_phone, c.address AS client_address,
            c.address_line_1, c.city, c.state, c.zip_code, c.country,
            c.contact_person, u.name AS created_by_name,
            t.name AS team_name, o.organization_name,
            ou.email AS organization_email, o.contact_number AS organization_phone,
            o.address_line_1 AS organization_address_line_1,
            o.address_line_2 AS organization_address_line_2,
            o.logo_url AS organization_logo_key,
            b.accent_color, b.invoice_appearance,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'id', pii.id,
                  'description', pii.description,
                  'quantity', pii.quantity,
                  'unitAmount', pii.unit_amount,
                  'lineAmount', pii.line_amount,
                  'position', pii.position
                ) ORDER BY pii.position
              ) FILTER (WHERE pii.id IS NOT NULL),
              '[]'::JSONB
            ) AS items
       FROM portal_invoices pi
       JOIN clients c ON c.id = pi.client_id AND c.team_id = pi.team_id
       JOIN teams t ON t.id = pi.team_id
       LEFT JOIN organizations o
         ON (t.organization_id = o.id OR t.user_id = o.user_id)
       LEFT JOIN organization_branding b ON b.organization_id = o.id
       LEFT JOIN users ou ON ou.id = o.user_id
       JOIN users u ON u.id = pi.created_by_user_id
       LEFT JOIN portal_requests pr
         ON pr.id = pi.request_id AND pr.team_id = pi.team_id
       LEFT JOIN portal_services ps
         ON ps.id = pr.service_id AND ps.team_id = pr.team_id
       LEFT JOIN portal_invoice_items pii
         ON pii.invoice_id = pi.id AND pii.team_id = pi.team_id
      WHERE pi.id = $1::UUID AND pi.team_id = $2::UUID
        AND ($3::UUID IS NULL OR pi.client_id = $3::UUID)
      GROUP BY pi.id, pr.id, ps.id, c.id, u.id, t.id, o.id, ou.id,
               b.organization_id
      LIMIT 1`,
    [invoiceId, teamId, clientId || null],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  const appearance = row.invoice_appearance || {};
  return {
    ...mapInvoiceRow(row),
    notes: row.notes,
    items: (row.items || []).map((item: any) => ({
      ...item,
      quantity: Number(item.quantity),
      unitAmount: Number(item.unitAmount),
      lineAmount: Number(item.lineAmount),
    })),
    request: row.request_id
      ? {
          id: row.request_id,
          requestNumber: row.request_no,
          requestData: row.request_data,
          notes: row.request_notes,
          service: {
            id: row.service_id,
            name: row.service_name,
            description: row.service_description,
          },
        }
      : null,
    client: {
      id: row.client_id,
      name: row.client_name,
      companyName: row.company_name,
      email: row.client_email,
      phone: row.client_phone,
      address:
        row.client_address ||
        [row.address_line_1, row.city, row.state, row.zip_code, row.country]
          .filter(Boolean)
          .join(", "),
      contactPerson: row.contact_person,
    },
    createdBy: { name: row.created_by_name },
    organization: {
      name: appearance.name || row.organization_name || row.team_name,
      logoKey: row.organization_logo_key,
      primaryColor: appearance.primaryColor || row.accent_color || "#1677ff",
      email: appearance.email || row.organization_email || null,
      phone: appearance.phone || row.organization_phone || null,
      addressLine1:
        appearance.addressLine1 || row.organization_address_line_1 || null,
      addressLine2:
        appearance.addressLine2 || row.organization_address_line_2 || null,
      invoiceFooterMessage: appearance.footerMessage || null,
    },
  };
}

export async function createInvoice(input: {
  teamId: string;
  userId: string;
  invoice: InvoiceWriteInput;
}) {
  const totals = calculateInvoiceTotals(
    input.invoice.lineItems,
    input.invoice.discountType,
    input.invoice.discountValue,
    input.invoice.taxRate,
  );
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const request = await client.query(
      `SELECT pr.client_id
         FROM portal_requests pr
         JOIN clients c
           ON c.id = pr.client_id AND c.team_id = pr.team_id
        WHERE pr.id = $1::UUID AND pr.team_id = $2::UUID
          AND c.status = 'active'
        FOR UPDATE`,
      [input.invoice.requestId, input.teamId],
    );
    if (!request.rowCount) throw new Error("Invoice request not found");
    const sequence = await client.query(
      `SELECT nextval(pg_get_serial_sequence('portal_invoices', 'invoice_sequence'))::BIGINT AS sequence`,
    );
    const sequenceValue = String(sequence.rows[0].sequence);
    const invoiceNumber = `INV-${new Date().getUTCFullYear()}-${sequenceValue.padStart(6, "0")}`;
    const inserted = await client.query(
      `INSERT INTO portal_invoices
         (invoice_sequence, invoice_no, team_id, client_id, request_id,
          created_by_user_id, status, currency, subtotal, discount_type,
          discount_value, discount_amount, tax_rate, tax_amount, amount,
          due_date, notes)
       VALUES
         ($1::BIGINT, $2, $3::UUID, $4::UUID, $5::UUID, $6::UUID, 'draft',
          $7, $8, $9, $10, $11, $12, $13, $14, $15::DATE, $16)
       RETURNING id`,
      [
        sequenceValue,
        invoiceNumber,
        input.teamId,
        request.rows[0].client_id,
        input.invoice.requestId,
        input.userId,
        input.invoice.currency,
        totals.subtotal,
        input.invoice.discountType,
        input.invoice.discountValue,
        totals.discountAmount,
        input.invoice.taxRate,
        totals.taxAmount,
        totals.amount,
        input.invoice.dueDate,
        input.invoice.notes,
      ],
    );
    await insertItems(
      client,
      inserted.rows[0].id,
      input.teamId,
      request.rows[0].client_id,
      totals,
    );
    await client.query("COMMIT");
    return { id: inserted.rows[0].id, requestedStatus: input.invoice.status };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertItems(
  client: PoolClient,
  invoiceId: string,
  teamId: string,
  clientId: string,
  totals: InvoiceTotals,
) {
  for (let position = 0; position < totals.items.length; position += 1) {
    const item = totals.items[position];
    await client.query(
      `INSERT INTO portal_invoice_items
         (invoice_id, team_id, client_id, position, description, quantity,
          unit_amount, line_amount)
       VALUES ($1::UUID, $2::UUID, $3::UUID, $4, $5, $6, $7, $8)`,
      [
        invoiceId,
        teamId,
        clientId,
        position,
        item.description,
        item.quantity,
        item.rate,
        item.amount,
      ],
    );
  }
}

export async function updateInvoice(input: {
  id: string;
  teamId: string;
  invoice: InvoiceWriteInput;
}) {
  const totals = calculateInvoiceTotals(
    input.invoice.lineItems,
    input.invoice.discountType,
    input.invoice.discountValue,
    input.invoice.taxRate,
  );
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT client_id, status, version
         FROM portal_invoices
        WHERE id = $1::UUID AND team_id = $2::UUID
        FOR UPDATE`,
      [input.id, input.teamId],
    );
    if (!locked.rowCount) throw new Error("Invoice not found");
    if (locked.rows[0].status !== "draft") {
      throw new Error("Only draft invoices can be edited");
    }
    if (
      input.invoice.version !== undefined &&
      Number(locked.rows[0].version) !== input.invoice.version
    ) {
      throw new Error("Invoice was updated by another user");
    }
    await client.query(
      `UPDATE portal_invoices
          SET currency = $3, subtotal = $4, discount_type = $5,
              discount_value = $6, discount_amount = $7, tax_rate = $8,
              tax_amount = $9, amount = $10, due_date = $11::DATE,
              notes = $12, version = version + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID AND team_id = $2::UUID`,
      [
        input.id,
        input.teamId,
        input.invoice.currency,
        totals.subtotal,
        input.invoice.discountType,
        input.invoice.discountValue,
        totals.discountAmount,
        input.invoice.taxRate,
        totals.taxAmount,
        totals.amount,
        input.invoice.dueDate,
        input.invoice.notes,
      ],
    );
    await client.query(
      `DELETE FROM portal_invoice_items
        WHERE invoice_id = $1::UUID AND team_id = $2::UUID`,
      [input.id, input.teamId],
    );
    await insertItems(
      client,
      input.id,
      input.teamId,
      locked.rows[0].client_id,
      totals,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function generateInvoicePdf(invoice: any): Promise<Buffer> {
  let logoUrl: string | null = null;
  const logoKey = invoice.organization?.logoKey;
  if (typeof logoKey === "string" && logoKey) {
    if (/^https?:\/\//i.test(logoKey)) {
      logoUrl = logoKey;
    } else {
      try {
        logoUrl = await createPresignedViewUrl(
          logoKey,
          logoKey.split("/").pop() || "logo",
          300,
        );
      } catch {
        logoUrl = null;
      }
    }
  }
  const htmlData: InvoiceData = {
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    createdAt: invoice.createdAt,
    dueDate: invoice.dueDate,
    amount: invoice.amount,
    subtotal: invoice.subtotal,
    discountAmount: invoice.discountAmount,
    taxRate: invoice.taxRate,
    taxAmount: invoice.taxAmount,
    currency: invoice.currency,
    isOverdue: invoice.isOverdue,
    items: invoice.items.map((item: any) => ({
      description: item.description,
      quantity: item.quantity,
      unitAmount: item.unitAmount,
      lineAmount: item.lineAmount,
    })),
    client: invoice.client,
    request: invoice.request,
    notes: invoice.notes,
    organization: {
      ...invoice.organization,
      logoUrl,
    },
  };
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(InvoiceTemplateGenerator.generateInvoiceHTML(htmlData), {
      waitUntil: "networkidle0",
      timeout: 15_000,
    });
    return Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      }),
    );
  } finally {
    await browser.close();
  }
}
