import { PoolClient } from "pg";

import db from "../config/db";
import { IO } from "../shared/io";
import { getSelfHostedCapabilities } from "../shared/self-hosted-capabilities";
import { SocketEvents } from "../socket.io/events";

type Queryable = Pick<PoolClient, "query"> | typeof db;

export type PortalRequestEventType =
  | "request_created"
  | "request_status_updated"
  | "request_assigned"
  | "request_comment_added"
  | "request_attachment_added";

interface RequestEvent {
  requestId: string;
  requestNo: string;
  teamId: string;
  clientId: string;
  eventType: PortalRequestEventType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

interface StaffRequestEvent extends RequestEvent {
  includeAdministrators?: boolean;
  assignedUserId?: string | null;
  excludeUserId?: string | null;
}

interface ClientRequestEvent extends RequestEvent {
  excludeMembershipId?: string | null;
}

export async function createStaffRequestNotifications(
  queryable: Queryable,
  event: StaffRequestEvent,
): Promise<string[]> {
  if (
    !getSelfHostedCapabilities().capabilities
      .clientPortalRequestNotifications
  ) {
    return [];
  }
  const result = await queryable.query(
    `INSERT INTO user_notifications
       (message, user_id, team_id, portal_request_id)
     SELECT $4, recipients.user_id, $1::UUID, $3::UUID
       FROM (
         SELECT DISTINCT tm.user_id
           FROM team_members tm
           JOIN roles r ON r.id = tm.role_id AND r.team_id = tm.team_id
          WHERE tm.team_id = $1::UUID
            AND (
              ($6::BOOLEAN = TRUE AND (r.owner = TRUE OR r.name = 'Admin'))
              OR tm.user_id = $2::UUID
            )
       ) recipients
      WHERE ($5::UUID IS NULL OR recipients.user_id <> $5::UUID)
      RETURNING user_id`,
    [
      event.teamId,
      event.assignedUserId || null,
      event.requestId,
      event.message,
      event.excludeUserId || null,
      event.includeAdministrators !== false,
    ],
  );
  return result.rows.map((row) => String(row.user_id));
}

export async function createClientRequestNotifications(
  queryable: Queryable,
  event: ClientRequestEvent,
): Promise<void> {
  if (
    !getSelfHostedCapabilities().capabilities
      .clientPortalRequestNotifications
  ) {
    return;
  }
  await queryable.query(
    `INSERT INTO portal_notifications
       (team_id, client_id, membership_id, request_id, event_type,
        title, message, event_data)
     SELECT $1::UUID, $2::UUID, pcm.id, $3::UUID, $4, $5, $6, $7::JSONB
       FROM portal_client_memberships pcm
       JOIN portal_client_users pcu ON pcu.id = pcm.client_user_id
       JOIN clients c ON c.id = pcm.client_id AND c.team_id = pcm.team_id
      WHERE pcm.team_id = $1::UUID
        AND pcm.client_id = $2::UUID
        AND pcm.is_active = TRUE
        AND pcm.accepted_at IS NOT NULL
        AND pcu.status = 'active'
        AND c.status = 'active'
        AND c.client_portal_enabled = TRUE
        AND ($8::UUID IS NULL OR pcm.id <> $8::UUID)`,
    [
      event.teamId,
      event.clientId,
      event.requestId,
      event.eventType,
      event.title,
      event.message,
      JSON.stringify({
        requestId: event.requestId,
        requestNo: event.requestNo,
        ...event.data,
      }),
      event.excludeMembershipId || null,
    ],
  );
}

export function emitRequestEvent(
  event: RequestEvent,
  staffUserIds: string[] = [],
): void {
  if (
    !getSelfHostedCapabilities().capabilities
      .clientPortalRequestNotifications
  ) {
    return;
  }
  const payload = {
    requestId: event.requestId,
    requestNo: event.requestNo,
    eventType: event.eventType,
    title: event.title,
    message: event.message,
    ...event.data,
  };
  const io = IO.getInstance();
  for (const userId of new Set(staffUserIds)) {
    io?.to(`staff:user:${userId}`).emit("portal:request-event", payload);
    io
      ?.to(`staff:user:${userId}`)
      .emit(SocketEvents.NOTIFICATIONS_UPDATE.toString(), {
        team: "Client Portal",
        team_id: event.teamId,
        message: event.message,
        url: `/worklenz/client-portal/requests/${event.requestId}`,
      });
  }
  io
    ?.to(`portal:client:${event.teamId}:${event.clientId}`)
    .emit("portal:request-event", payload);
}
