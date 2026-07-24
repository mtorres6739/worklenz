import bcrypt from "bcrypt";
import { Response } from "express";

import db from "../config/db";
import { ClientPortalRequest } from "../interfaces/client-portal-request";
import { ServerResponse } from "../models/server-response";
import { getPublicBranding } from "../services/branding.service";
import { sendPortalPasswordReset } from "../services/client-portal-email.service";
import {
  auditPortalEvent,
  clearPortalCookie,
  createPortalSession,
  hashPortalToken,
  isStrongPortalPassword,
  normalizePortalEmail,
  portalTokenFromRequest,
  randomPortalToken,
  revokeAllPortalSessions,
  revokePortalSession,
  setPortalCookie,
} from "../services/client-portal-session.service";
import { IO } from "../shared/io";
import { getSelfHostedCapabilities } from "../shared/self-hosted-capabilities";

const genericLoginError = "Invalid email or password";
const dummyPortalPasswordHash = bcrypt.hashSync(
  "invalid-client-portal-password",
  12,
);

async function sessionBody(
  actor: NonNullable<ClientPortalRequest["portalActor"]>,
) {
  const selfHosted = getSelfHostedCapabilities().capabilities;
  const organizations = await db.query(
    `SELECT pcm.id AS membership_id,
            pcm.team_id,
            pcm.client_id,
            pcm.role,
            pcm.access_level,
            COALESCE(c.company_name, c.name) AS client_name,
            t.name AS organization_name
       FROM portal_client_memberships pcm
       JOIN clients c ON c.id = pcm.client_id AND c.team_id = pcm.team_id
       JOIN teams t ON t.id = pcm.team_id
      WHERE pcm.client_user_id = $1::UUID
        AND pcm.is_active = TRUE
        AND c.status = 'active'
        AND c.client_portal_enabled = TRUE
      ORDER BY pcm.accepted_at NULLS LAST, pcm.created_at`,
    [actor.clientUserId],
  );
  return {
    authenticated: true,
    audience: "client_portal",
    csrf_token: actor.csrfToken,
    expires_at: actor.expiresAt,
    user: {
      id: actor.clientUserId,
      name: actor.name,
      email: actor.email,
      role: actor.role,
      access_level: actor.accessLevel,
    },
    active: {
      membership_id: actor.membershipId,
      team_id: actor.teamId,
      client_id: actor.clientId,
    },
    organizations: organizations.rows,
    branding: await getPublicBranding(actor.teamId),
    capabilities: {
      services: selfHosted.clientPortalServices,
      requests: selfHosted.clientPortalRequests,
      requestNotifications: selfHosted.clientPortalRequestNotifications,
      invoices: selfHosted.clientPortalInvoices,
      payments: selfHosted.clientPortalPayments,
      stripeCheckout: selfHosted.stripeCheckout,
    },
  };
}

export default class ClientPortalAuthController {
  public static async invitation(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const token = String(req.params.token || "");
    if (!/^[0-9a-f]{64}$/i.test(token)) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Invitation not found"));
    }
    const result = await db.query(
      `SELECT pi.team_id, pi.email, pi.name, pi.role, pi.access_level, pi.expires_at,
              EXISTS (
                SELECT 1 FROM portal_client_users pcu
                 WHERE lower(pcu.email::TEXT) = lower(pi.email::TEXT)
              ) AS has_existing_account,
              COALESCE(c.company_name, c.name) AS client_name,
              t.name AS organization_name
         FROM portal_invitations pi
         JOIN clients c ON c.id = pi.client_id AND c.team_id = pi.team_id
         JOIN teams t ON t.id = pi.team_id
        WHERE pi.token_hash = $1 AND pi.status = 'pending'
          AND pi.expires_at > CURRENT_TIMESTAMP
          AND c.status <> 'inactive'
        LIMIT 1`,
      [hashPortalToken(token)],
    );
    if (!result.rowCount) {
      return res
        .status(404)
        .send(
          new ServerResponse(false, null, "Invitation is invalid or expired"),
        );
    }
    const { team_id: teamId, ...invitation } = result.rows[0];
    return res.send(
      new ServerResponse(true, {
        ...invitation,
        branding: await getPublicBranding(teamId),
      }),
    );
  }

  public static async acceptInvitation(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const rawToken = String(req.params.token || "");
    const name = String(req.body?.name || "").trim();
    const password = req.body?.password;
    if (!/^[0-9a-f]{64}$/i.test(rawToken) || !name || name.length > 120) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid invitation details"));
    }
    if (!isStrongPortalPassword(password)) {
      return res
        .status(400)
        .send(
          new ServerResponse(
            false,
            null,
            "Use at least 12 characters with upper, lower, number, and symbol",
          ),
        );
    }

    const client = await db.pool.connect();
    let clientUserId = "";
    let membershipId = "";
    let teamId = "";
    let clientId = "";
    try {
      await client.query("BEGIN");
      const invitationResult = await client.query(
        `SELECT pi.*, c.status AS client_status
           FROM portal_invitations pi
           JOIN clients c ON c.id = pi.client_id AND c.team_id = pi.team_id
          WHERE pi.token_hash = $1
          FOR UPDATE OF pi`,
        [hashPortalToken(rawToken)],
      );
      const invitation = invitationResult.rows[0];
      if (
        !invitation ||
        invitation.status !== "pending" ||
        new Date(invitation.expires_at).getTime() <= Date.now()
      ) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .send(
            new ServerResponse(false, null, "Invitation is invalid or expired"),
          );
      }
      if (invitation.client_status === "inactive") {
        await client.query("ROLLBACK");
        return res
          .status(403)
          .send(
            new ServerResponse(false, null, "Client portal access is disabled"),
          );
      }

      teamId = invitation.team_id;
      clientId = invitation.client_id;
      const existing = await client.query(
        `SELECT id, password_hash FROM portal_client_users
          WHERE lower(email::TEXT) = lower($1) FOR UPDATE`,
        [invitation.email],
      );
      if (existing.rowCount) {
        if (!(await bcrypt.compare(password, existing.rows[0].password_hash))) {
          await client.query("ROLLBACK");
          return res
            .status(401)
            .send(
              new ServerResponse(
                false,
                null,
                "This email already has a portal account. Enter its existing password.",
              ),
            );
        }
        clientUserId = existing.rows[0].id;
        await client.query(
          `UPDATE portal_client_users SET name = $2, status = 'active', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1::UUID`,
          [clientUserId, name],
        );
      } else {
        const created = await client.query(
          `INSERT INTO portal_client_users (email, name, password_hash)
           VALUES ($1, $2, $3) RETURNING id`,
          [
            normalizePortalEmail(invitation.email),
            name,
            await bcrypt.hash(password, 12),
          ],
        );
        clientUserId = created.rows[0].id;
      }

      const membership = await client.query(
        `INSERT INTO portal_client_memberships
           (client_user_id, team_id, client_id, role, access_level, is_active, invited_by, accepted_at)
         VALUES ($1::UUID, $2::UUID, $3::UUID, $4, $5, TRUE, $6::UUID, CURRENT_TIMESTAMP)
         ON CONFLICT (client_user_id, team_id, client_id)
         DO UPDATE SET role = EXCLUDED.role,
                       access_level = EXCLUDED.access_level,
                       is_active = TRUE,
                       accepted_at = CURRENT_TIMESTAMP,
                       updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [
          clientUserId,
          teamId,
          clientId,
          invitation.role,
          invitation.access_level,
          invitation.invited_by,
        ],
      );
      membershipId = membership.rows[0].id;

      await client.query(
        `UPDATE portal_invitations
            SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP,
                accepted_by_client_user_id = $2::UUID, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::UUID`,
        [invitation.id, clientUserId],
      );
      await client.query(
        `UPDATE clients SET status = 'active', client_portal_enabled = TRUE, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::UUID AND team_id = $2::UUID`,
        [clientId, teamId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const session = await createPortalSession(clientUserId, membershipId, req);
    setPortalCookie(res, session.rawToken);
    const actor = await db.query(
      `SELECT pcu.email, pcu.name, pcm.role, pcm.access_level
         FROM portal_client_users pcu JOIN portal_client_memberships pcm ON pcm.client_user_id = pcu.id
        WHERE pcu.id = $1::UUID AND pcm.id = $2::UUID`,
      [clientUserId, membershipId],
    );
    const sessionActor = {
      sessionId: "new",
      clientUserId,
      membershipId,
      teamId,
      clientId,
      email: actor.rows[0].email,
      name: actor.rows[0].name,
      role: actor.rows[0].role,
      accessLevel: actor.rows[0].access_level,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    } as NonNullable<ClientPortalRequest["portalActor"]>;
    await auditPortalEvent({
      action: "invitation.accepted",
      actor: sessionActor,
      req,
    });
    return res
      .status(201)
      .send(
        new ServerResponse(
          true,
          await sessionBody(sessionActor),
          "Invitation accepted",
        ),
      );
  }

  public static async login(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const email = normalizePortalEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const requestedMembershipId = req.body?.membership_id
      ? String(req.body.membership_id)
      : null;
    const userResult = await db.query(
      `SELECT id, email, name, password_hash FROM portal_client_users
        WHERE lower(email::TEXT) = lower($1) AND status = 'active' LIMIT 1`,
      [email],
    );
    const user = userResult.rows[0];
    const passwordMatches = await bcrypt.compare(
      password,
      user?.password_hash || dummyPortalPasswordHash,
    );
    if (!user || !passwordMatches) {
      await auditPortalEvent({
        action: "auth.login",
        success: false,
        details: { email },
        req,
      });
      return res
        .status(401)
        .send(new ServerResponse(false, null, genericLoginError));
    }
    const membershipResult = await db.query(
      `SELECT pcm.id, pcm.team_id, pcm.client_id, pcm.role, pcm.access_level
         FROM portal_client_memberships pcm
         JOIN clients c ON c.id = pcm.client_id AND c.team_id = pcm.team_id
        WHERE pcm.client_user_id = $1::UUID
          AND pcm.is_active = TRUE AND c.status = 'active' AND c.client_portal_enabled = TRUE
          AND ($2::UUID IS NULL OR pcm.id = $2::UUID)
        ORDER BY pcm.last_access_at DESC NULLS LAST, pcm.accepted_at NULLS LAST, pcm.created_at
        LIMIT 1`,
      [user.id, requestedMembershipId],
    );
    const membership = membershipResult.rows[0];
    if (!membership) {
      await auditPortalEvent({
        action: "auth.login",
        success: false,
        details: { email, reason: "no_active_membership" },
        req,
      });
      return res
        .status(401)
        .send(new ServerResponse(false, null, genericLoginError));
    }

    await revokePortalSession(portalTokenFromRequest(req));
    const session = await createPortalSession(user.id, membership.id, req);
    setPortalCookie(res, session.rawToken);
    await db.query(
      `UPDATE portal_client_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1::UUID`,
      [user.id],
    );
    const actor = {
      sessionId: "new",
      clientUserId: user.id,
      membershipId: membership.id,
      teamId: membership.team_id,
      clientId: membership.client_id,
      email: user.email,
      name: user.name,
      role: membership.role,
      accessLevel: membership.access_level,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    } as NonNullable<ClientPortalRequest["portalActor"]>;
    await auditPortalEvent({ action: "auth.login", actor, req });
    return res.send(new ServerResponse(true, await sessionBody(actor)));
  }

  public static async session(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    if (!req.portalActor)
      return res
        .status(401)
        .send(new ServerResponse(false, null, "Unauthorized"));
    return res.send(
      new ServerResponse(true, await sessionBody(req.portalActor)),
    );
  }

  public static async logout(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    if (req.portalActor)
      await auditPortalEvent({
        action: "auth.logout",
        actor: req.portalActor,
        req,
      });
    await revokePortalSession(portalTokenFromRequest(req));
    if (req.portalActor) {
      IO.getInstance()
        ?.in(`portal:membership:${req.portalActor.membershipId}`)
        .disconnectSockets(true);
    }
    clearPortalCookie(res);
    return res.send(new ServerResponse(true, null, "Signed out"));
  }

  public static async switchMembership(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor;
    const membershipId = String(req.body?.membership_id || "");
    if (!actor || !/^[0-9a-f-]{36}$/i.test(membershipId)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid membership"));
    }
    const result = await db.query(
      `SELECT id FROM portal_client_memberships
        WHERE id = $1::UUID AND client_user_id = $2::UUID AND is_active = TRUE`,
      [membershipId, actor.clientUserId],
    );
    if (!result.rowCount)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Membership not found"));
    await revokePortalSession(portalTokenFromRequest(req));
    const session = await createPortalSession(
      actor.clientUserId,
      membershipId,
      req,
    );
    setPortalCookie(res, session.rawToken);
    return res.send(
      new ServerResponse(true, {
        csrf_token: session.csrfToken,
        expires_at: session.expiresAt,
      }),
    );
  }

  public static async requestPasswordReset(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const email = normalizePortalEmail(req.body?.email);
    const result = await db.query(
      `SELECT pcu.id, pcu.name, pcu.email, pcm.team_id
         FROM portal_client_users pcu
         JOIN portal_client_memberships pcm ON pcm.client_user_id = pcu.id AND pcm.is_active = TRUE
        WHERE lower(pcu.email::TEXT) = lower($1) AND pcu.status = 'active'
        ORDER BY pcm.created_at LIMIT 1`,
      [email],
    );
    const user = result.rows[0];
    if (user) {
      const rawToken = randomPortalToken();
      await db.query(
        `UPDATE portal_password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE client_user_id = $1::UUID AND used_at IS NULL`,
        [user.id],
      );
      await db.query(
        `INSERT INTO portal_password_reset_tokens (client_user_id, token_hash, expires_at)
         VALUES ($1::UUID, $2, CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
        [user.id, hashPortalToken(rawToken)],
      );
      try {
        await sendPortalPasswordReset({
          teamId: user.team_id,
          email: user.email,
          name: user.name,
          rawToken,
        });
      } catch {
        // Keep the response indistinguishable to prevent account enumeration.
      }
    }
    return res.send(
      new ServerResponse(
        true,
        null,
        "If that account exists, a reset link has been sent",
      ),
    );
  }

  public static async resetPassword(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const rawToken = String(req.body?.token || "");
    const password = req.body?.password;
    if (
      !/^[0-9a-f]{64}$/i.test(rawToken) ||
      !isStrongPortalPassword(password)
    ) {
      return res
        .status(400)
        .send(
          new ServerResponse(
            false,
            null,
            "Invalid reset request or weak password",
          ),
        );
    }
    const client = await db.pool.connect();
    let clientUserId = "";
    try {
      await client.query("BEGIN");
      const reset = await client.query(
        `SELECT id, client_user_id FROM portal_password_reset_tokens
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
          FOR UPDATE`,
        [hashPortalToken(rawToken)],
      );
      if (!reset.rowCount) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .send(
            new ServerResponse(false, null, "Reset link is invalid or expired"),
          );
      }
      clientUserId = reset.rows[0].client_user_id;
      await client.query(
        `UPDATE portal_client_users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::UUID`,
        [clientUserId, await bcrypt.hash(password, 12)],
      );
      await client.query(
        `UPDATE portal_password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1::UUID`,
        [reset.rows[0].id],
      );
      await client.query(
        `UPDATE portal_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE client_user_id = $1::UUID AND revoked_at IS NULL`,
        [clientUserId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    clearPortalCookie(res);
    await revokeAllPortalSessions(clientUserId);
    IO.getInstance()?.in(`portal:user:${clientUserId}`).disconnectSockets(true);
    return res.send(new ServerResponse(true, null, "Password updated"));
  }
}
