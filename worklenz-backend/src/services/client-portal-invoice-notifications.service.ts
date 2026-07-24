import { PoolClient } from "pg";

import db from "../config/db";
import { IO } from "../shared/io";
import { getSelfHostedCapabilities } from "../shared/self-hosted-capabilities";
import { SocketEvents } from "../socket.io/events";

type Queryable = Pick<PoolClient, "query"> | typeof db;

export type PortalInvoiceEventType =
  | "invoice_sent"
  | "invoice_payment_pending"
  | "invoice_paid"
  | "invoice_payment_failed"
  | "invoice_refunded";

export interface InvoiceEvent {
  invoiceId: string;
  invoiceNumber: string;
  teamId: string;
  clientId: string;
  eventType: PortalInvoiceEventType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

export async function createClientInvoiceNotifications(
  queryable: Queryable,
  event: InvoiceEvent,
): Promise<void> {
  const capabilities = getSelfHostedCapabilities().capabilities;
  if (
    !capabilities.clientPortalInvoices ||
    !capabilities.clientPortalRequestNotifications
  ) {
    return;
  }
  await queryable.query(
    `INSERT INTO portal_notifications
       (team_id, client_id, membership_id, request_id, invoice_id, event_type,
        title, message, event_data)
     SELECT $1::UUID, $2::UUID, pcm.id, NULL, $3::UUID, $4, $5, $6, $7::JSONB
       FROM portal_client_memberships pcm
       JOIN portal_client_users pcu ON pcu.id = pcm.client_user_id
       JOIN clients c ON c.id = pcm.client_id AND c.team_id = pcm.team_id
      WHERE pcm.team_id = $1::UUID AND pcm.client_id = $2::UUID
        AND pcm.is_active = TRUE AND pcm.accepted_at IS NOT NULL
        AND pcu.status = 'active' AND c.status = 'active'
        AND c.client_portal_enabled = TRUE`,
    [
      event.teamId,
      event.clientId,
      event.invoiceId,
      event.eventType,
      event.title,
      event.message,
      JSON.stringify({
        invoiceId: event.invoiceId,
        invoiceNumber: event.invoiceNumber,
        ...event.data,
      }),
    ],
  );
}

export async function createStaffInvoiceNotifications(
  queryable: Queryable,
  event: InvoiceEvent,
  excludeUserId?: string | null,
): Promise<string[]> {
  const capabilities = getSelfHostedCapabilities().capabilities;
  if (
    !capabilities.clientPortalInvoices ||
    !capabilities.clientPortalRequestNotifications
  ) {
    return [];
  }
  const result = await queryable.query(
    `INSERT INTO user_notifications
       (message, user_id, team_id, portal_invoice_id)
     SELECT $3, recipients.user_id, $1::UUID, $2::UUID
       FROM (
         SELECT DISTINCT tm.user_id
           FROM team_members tm
           JOIN roles r ON r.id = tm.role_id AND r.team_id = tm.team_id
          WHERE tm.team_id = $1::UUID
            AND (r.owner = TRUE OR r.name = 'Admin')
       ) recipients
      WHERE ($4::UUID IS NULL OR recipients.user_id <> $4::UUID)
      RETURNING user_id`,
    [
      event.teamId,
      event.invoiceId,
      event.message,
      excludeUserId || null,
    ],
  );
  return result.rows.map((row) => String(row.user_id));
}

export function emitInvoiceEvent(
  event: InvoiceEvent,
  staffUserIds: string[] = [],
): void {
  const capabilities = getSelfHostedCapabilities().capabilities;
  if (
    !capabilities.clientPortalInvoices ||
    !capabilities.clientPortalRequestNotifications
  ) {
    return;
  }
  const payload = {
    invoiceId: event.invoiceId,
    invoiceNumber: event.invoiceNumber,
    eventType: event.eventType,
    title: event.title,
    message: event.message,
    ...event.data,
  };
  const io = IO.getInstance();
  for (const userId of new Set(staffUserIds)) {
    io?.to(`staff:user:${userId}`).emit("portal:invoice-event", payload);
    io
      ?.to(`staff:user:${userId}`)
      .emit(SocketEvents.NOTIFICATIONS_UPDATE.toString(), {
        team: "Client Portal",
        team_id: event.teamId,
        message: event.message,
        url: `/worklenz/client-portal/invoices/${event.invoiceId}`,
      });
  }
  io
    ?.to(`portal:client:${event.teamId}:${event.clientId}`)
    .emit("portal:invoice-event", payload);
}
