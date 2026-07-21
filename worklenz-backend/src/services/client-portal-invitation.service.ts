import { PoolClient } from "pg";

import db from "../config/db";
import {
  hashPortalToken,
  normalizePortalEmail,
  randomPortalToken,
} from "./client-portal-session.service";
import { portalInvitationUrl, sendPortalInvitation } from "./client-portal-email.service";

export interface PortalInvitationResult {
  invitationId: string;
  invitationLink: string;
  expiresAt: string;
  emailSent: boolean;
}

export async function createPortalInvitation(input: {
  teamId: string;
  clientId: string;
  email: string;
  name: string;
  role?: "admin" | "member";
  accessLevel?: "view" | "comment";
  invitedBy: string;
  inviterName: string;
}): Promise<PortalInvitationResult> {
  const email = normalizePortalEmail(input.email);
  const rawToken = randomPortalToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const client: PoolClient = await db.pool.connect();
  let invitationId = "";
  let clientName = "";

  try {
    await client.query("BEGIN");
    const scope = await client.query(
      `SELECT id, COALESCE(company_name, name) AS display_name
         FROM clients
        WHERE id = $1::UUID AND team_id = $2::UUID
        FOR UPDATE`,
      [input.clientId, input.teamId],
    );
    if (!scope.rowCount) throw new Error("Client not found");
    clientName = scope.rows[0].display_name;

    await client.query(
      `UPDATE portal_invitations
          SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE team_id = $1::UUID AND client_id = $2::UUID
          AND lower(email::TEXT) = lower($3) AND status = 'pending'`,
      [input.teamId, input.clientId, email],
    );

    const inserted = await client.query(
      `INSERT INTO portal_invitations
         (team_id, client_id, email, name, role, access_level, token_hash, invited_by, expires_at)
       VALUES ($1::UUID, $2::UUID, $3, $4, $5, $6, $7, $8::UUID, $9::TIMESTAMPTZ)
       RETURNING id`,
      [
        input.teamId,
        input.clientId,
        email,
        input.name.trim(),
        input.role || "member",
        input.accessLevel || "view",
        hashPortalToken(rawToken),
        input.invitedBy,
        expiresAt.toISOString(),
      ],
    );
    invitationId = inserted.rows[0].id;

    await client.query(
      `UPDATE clients
          SET client_portal_enabled = TRUE,
              email = COALESCE(email, $3),
              status = CASE WHEN status = 'inactive' THEN status ELSE 'pending' END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID AND team_id = $2::UUID`,
      [input.clientId, input.teamId, email],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  let emailSent = false;
  try {
    emailSent = await sendPortalInvitation({
      teamId: input.teamId,
      email,
      inviteeName: input.name,
      clientName,
      inviterName: input.inviterName,
      rawToken,
      expiresAt,
    });
  } catch {
    emailSent = false;
  }

  return {
    invitationId,
    invitationLink: portalInvitationUrl(rawToken),
    expiresAt: expiresAt.toISOString(),
    emailSent,
  };
}
