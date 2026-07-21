import crypto from "crypto";
import { Request, Response } from "express";

import db from "../config/db";
import { ClientPortalActor } from "../interfaces/client-portal-request";

export const CLIENT_PORTAL_COOKIE = "worklenz.client.sid";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export function hashPortalToken(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function randomPortalToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function normalizePortalEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function isStrongPortalPassword(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) return false;
  return /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

export function setPortalCookie(res: Response, rawToken: string): void {
  res.cookie(CLIENT_PORTAL_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_MS,
  });
}

export function clearPortalCookie(res: Response): void {
  res.clearCookie(CLIENT_PORTAL_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export function portalTokenFromRequest(req: Request): string | null {
  const value = req.cookies?.[CLIENT_PORTAL_COOKIE];
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value) ? value : null;
}

export function portalTokenFromCookieHeader(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== CLIENT_PORTAL_COOKIE) continue;
    try {
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      return /^[0-9a-f]{64}$/i.test(value) ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function createPortalSession(
  clientUserId: string,
  membershipId: string,
  req: Request,
): Promise<{ rawToken: string; csrfToken: string; expiresAt: string }> {
  const rawToken = randomPortalToken();
  const csrfToken = randomPortalToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  await db.query(
    `INSERT INTO portal_sessions
       (client_user_id, membership_id, token_hash, csrf_token, expires_at, ip_address, user_agent)
     VALUES ($1::UUID, $2::UUID, $3, $4, $5::TIMESTAMPTZ, $6::INET, $7)`,
    [
      clientUserId,
      membershipId,
      hashPortalToken(rawToken),
      csrfToken,
      expiresAt,
      req.ip || null,
      String(req.get("user-agent") || "").slice(0, 1000) || null,
    ],
  );

  return { rawToken, csrfToken, expiresAt };
}

export async function getPortalActorByRawToken(rawToken: string): Promise<ClientPortalActor | null> {
  const result = await db.query(
    `SELECT ps.id AS session_id,
            ps.csrf_token,
            ps.expires_at,
            pcu.id AS client_user_id,
            pcu.email,
            pcu.name,
            pcm.id AS membership_id,
            pcm.team_id,
            pcm.client_id,
            pcm.role,
            pcm.access_level
       FROM portal_sessions ps
       JOIN portal_client_users pcu ON pcu.id = ps.client_user_id
       JOIN portal_client_memberships pcm ON pcm.id = ps.membership_id
       JOIN clients c ON c.id = pcm.client_id AND c.team_id = pcm.team_id
      WHERE ps.token_hash = $1
        AND ps.audience = 'client_portal'
        AND ps.revoked_at IS NULL
        AND ps.expires_at > CURRENT_TIMESTAMP
        AND pcu.status = 'active'
        AND pcm.is_active = TRUE
        AND c.status = 'active'
        AND c.client_portal_enabled = TRUE
      LIMIT 1`,
    [hashPortalToken(rawToken)],
  );

  const row = result.rows[0];
  if (!row) return null;

  void db.query(
    `UPDATE portal_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = $1::UUID
       AND last_seen_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'`,
    [row.session_id],
  );
  void db.query(
    `UPDATE portal_client_memberships SET last_access_at = CURRENT_TIMESTAMP WHERE id = $1::UUID
       AND (last_access_at IS NULL OR last_access_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes')`,
    [row.membership_id],
  );

  return {
    sessionId: row.session_id,
    clientUserId: row.client_user_id,
    membershipId: row.membership_id,
    teamId: row.team_id,
    clientId: row.client_id,
    email: row.email,
    name: row.name,
    role: row.role,
    accessLevel: row.access_level,
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
  };
}

export async function revokePortalSession(rawToken: string | null): Promise<void> {
  if (!rawToken) return;
  await db.query(
    `UPDATE portal_sessions SET revoked_at = CURRENT_TIMESTAMP
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashPortalToken(rawToken)],
  );
}

export async function revokeAllPortalSessions(clientUserId: string): Promise<void> {
  await db.query(
    `UPDATE portal_sessions SET revoked_at = CURRENT_TIMESTAMP
      WHERE client_user_id = $1::UUID AND revoked_at IS NULL`,
    [clientUserId],
  );
}

export async function auditPortalEvent(input: {
  action: string;
  success?: boolean;
  actor?: ClientPortalActor | null;
  staffUserId?: string | null;
  teamId?: string | null;
  clientId?: string | null;
  details?: Record<string, unknown>;
  req?: Request;
}): Promise<void> {
  await db.query(
    `INSERT INTO portal_audit_log
       (team_id, client_id, client_user_id, staff_user_id, action, success, details, ip_address, user_agent)
     VALUES ($1::UUID, $2::UUID, $3::UUID, $4::UUID, $5, $6, $7::JSONB, $8::INET, $9)`,
    [
      input.actor?.teamId || input.teamId || null,
      input.actor?.clientId || input.clientId || null,
      input.actor?.clientUserId || null,
      input.staffUserId || null,
      input.action,
      input.success !== false,
      JSON.stringify(input.details || {}),
      input.req?.ip || null,
      String(input.req?.get("user-agent") || "").slice(0, 1000) || null,
    ],
  );
}
