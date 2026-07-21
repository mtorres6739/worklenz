import { Server, Socket } from "socket.io";

import db from "../config/db";
import { ClientPortalActor } from "../interfaces/client-portal-request";

export async function registerClientPortalSocketHandlers(io: Server, socket: Socket): Promise<void> {
  const actor = socket.data.portalActor as ClientPortalActor | undefined;
  if (!actor) return;

  socket.join(`portal:user:${actor.clientUserId}`);
  socket.join(`portal:membership:${actor.membershipId}`);
  socket.join(`portal:client:${actor.teamId}:${actor.clientId}`);
  const projects = await db.query(
    `SELECT ppa.project_id
       FROM portal_project_access ppa
       JOIN projects p ON p.id = ppa.project_id AND p.team_id = ppa.team_id
       JOIN clients c ON c.id = ppa.client_id AND c.team_id = ppa.team_id
      WHERE ppa.team_id = $1::UUID AND ppa.client_id = $2::UUID
        AND p.client_portal_visible = TRUE
        AND c.status = 'active' AND c.client_portal_enabled = TRUE`,
    [actor.teamId, actor.clientId],
  );
  for (const row of projects.rows) socket.join(`portal:project:${row.project_id}`);

  socket.emit("portal:ready", {
    audience: "client_portal",
    clientId: actor.clientId,
    projectIds: projects.rows.map(row => row.project_id),
  });

  socket.on("portal:join-project", async (projectId: string, acknowledge?: (result: { ok: boolean }) => void) => {
    const allowed = await db.query(
      `SELECT 1
         FROM portal_project_access ppa
         JOIN projects p ON p.id = ppa.project_id AND p.team_id = ppa.team_id
         JOIN clients c ON c.id = ppa.client_id AND c.team_id = ppa.team_id
        WHERE ppa.project_id = $1::UUID AND ppa.team_id = $2::UUID AND ppa.client_id = $3::UUID
          AND p.client_portal_visible = TRUE
          AND c.status = 'active' AND c.client_portal_enabled = TRUE`,
      [projectId, actor.teamId, actor.clientId],
    ).catch(() => ({ rowCount: 0 }));
    if (allowed.rowCount) socket.join(`portal:project:${projectId}`);
    acknowledge?.({ ok: Boolean(allowed.rowCount) });
  });

  // No arbitrary room names, staff rooms, or cross-client identifiers are accepted.
  void io;
}
