import { Response } from "express";

import db from "../config/db";
import { IWorkLenzRequest } from "../interfaces/worklenz-request";
import { ServerResponse } from "../models/server-response";
import { createPortalInvitation } from "../services/client-portal-invitation.service";
import { auditPortalEvent } from "../services/client-portal-session.service";
import { isValidateEmail } from "../shared/utils";
import { IO } from "../shared/io";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SORT_FIELDS: Record<string, string> = {
  name: "c.name",
  company_name: "c.company_name",
  status: "c.status",
  created_at: "c.created_at",
  updated_at: "c.updated_at",
};

function actor(req: IWorkLenzRequest) {
  if (!req.user?.id || !req.user?.team_id) throw new Error("Missing staff session scope");
  return { userId: req.user.id, teamId: req.user.team_id, name: req.user.name || "SDM team" };
}

function text(value: unknown, max: number): string | null {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, max) : null;
}

async function clientInTeam(clientId: string, teamId: string) {
  const result = await db.query(`SELECT * FROM clients WHERE id = $1::UUID AND team_id = $2::UUID`, [clientId, teamId]);
  return result.rows[0] || null;
}

export default class ClientPortalAdminController {
  public static async dashboard(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const { teamId } = actor(req);
    const result = await db.query(
      `SELECT COUNT(*)::INT AS total_clients,
              COUNT(*) FILTER (WHERE c.client_portal_enabled AND c.status = 'active')::INT AS active_clients,
              (SELECT COUNT(*)::INT FROM portal_project_access WHERE team_id = $1::UUID) AS assigned_projects,
              (SELECT COUNT(*)::INT FROM portal_client_memberships WHERE team_id = $1::UUID AND is_active = TRUE) AS client_users
         FROM clients c WHERE c.team_id = $1::UUID`,
      [teamId],
    );
    return res.send(new ServerResponse(true, result.rows[0]));
  }

  public static async listClients(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const { teamId } = actor(req);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const search = String(req.query.search || "").trim();
    const status = ["active", "inactive", "pending"].includes(String(req.query.status)) ? String(req.query.status) : null;
    const sortField = SORT_FIELDS[String(req.query.sortBy)] || SORT_FIELDS.created_at;
    const sortOrder = String(req.query.sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";
    const result = await db.query(
      `SELECT c.id, c.name, c.email, c.company_name, c.phone, c.phone_country_code,
              c.address, c.address_line_1, c.city, c.state, c.zip_code, c.country,
              c.contact_person, c.status, c.client_portal_enabled,
              c.created_at, c.updated_at,
              COUNT(DISTINCT ppa.project_id)::INT AS assigned_projects_count,
              COUNT(DISTINCT pcm.id) FILTER (WHERE pcm.is_active = TRUE)::INT AS team_members_count,
              EXISTS (
                SELECT 1 FROM portal_client_memberships pm
                 WHERE pm.client_id = c.id AND pm.team_id = c.team_id AND pm.is_active = TRUE
              ) AS has_portal_access,
              (SELECT MAX(pi.created_at) FROM portal_invitations pi
                WHERE pi.client_id = c.id AND pi.team_id = c.team_id) AS invitation_sent_at,
              (SELECT pi.status FROM portal_invitations pi
                WHERE pi.client_id = c.id AND pi.team_id = c.team_id
                ORDER BY pi.created_at DESC LIMIT 1) AS invitation_status,
              COUNT(*) OVER()::INT AS full_count
         FROM clients c
         LEFT JOIN portal_project_access ppa ON ppa.client_id = c.id AND ppa.team_id = c.team_id
         LEFT JOIN portal_client_memberships pcm ON pcm.client_id = c.id AND pcm.team_id = c.team_id
        WHERE c.team_id = $1::UUID
          AND ($2 = '' OR c.name ILIKE '%' || $2 || '%' OR COALESCE(c.company_name, '') ILIKE '%' || $2 || '%' OR COALESCE(c.email::TEXT, '') ILIKE '%' || $2 || '%')
          AND ($3::TEXT IS NULL OR c.status = $3)
        GROUP BY c.id
        ORDER BY ${sortField} ${sortOrder}, c.id
        LIMIT $4 OFFSET $5`,
      [teamId, search, status, limit, (page - 1) * limit],
    );
    const clients = result.rows.map(row => ({
      ...row,
      portal_status: row.has_portal_access
        ? { status: "active", label: "Active", color: "green" }
        : row.invitation_status === "pending"
          ? { status: "invited", label: "Invited", color: "blue" }
          : { status: "not_invited", label: "Not invited", color: "default" },
      projects: [],
      team_members: [],
    }));
    return res.send(new ServerResponse(true, { clients, total: result.rows[0]?.full_count || 0, page, limit }));
  }

  public static async getClient(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const { teamId } = actor(req);
    const clientId = String(req.params.clientId || "");
    if (!UUID_PATTERN.test(clientId)) return res.status(400).send(new ServerResponse(false, null, "Invalid client"));
    const client = await clientInTeam(clientId, teamId);
    if (!client) return res.status(404).send(new ServerResponse(false, null, "Client not found"));
    const [projects, members] = await Promise.all([
      db.query(
        `SELECT p.id, p.name, p.key, COALESCE(sps.name, 'Active') AS status,
                ppa.access_level, ppa.can_view_files,
                COUNT(t.id)::INT AS total_tasks,
                COUNT(t.id) FILTER (WHERE stc.is_done = TRUE)::INT AS completed_tasks,
                p.updated_at AS last_updated
           FROM portal_project_access ppa
           JOIN projects p ON p.id = ppa.project_id AND p.team_id = ppa.team_id
           LEFT JOIN sys_project_statuses sps ON sps.id = p.status_id
           LEFT JOIN tasks t ON t.project_id = p.id AND t.archived = FALSE
           LEFT JOIN task_statuses ts ON ts.id = t.status_id
           LEFT JOIN sys_task_status_categories stc ON stc.id = ts.category_id
          WHERE ppa.team_id = $1::UUID AND ppa.client_id = $2::UUID
          GROUP BY p.id, sps.name, ppa.access_level, ppa.can_view_files
          ORDER BY p.name`,
        [teamId, clientId],
      ),
      db.query(
        `SELECT pcu.id, pcu.name, pcu.email, pcm.role, pcm.access_level,
                CASE WHEN pcm.is_active THEN 'active' ELSE 'inactive' END AS status,
                pcm.accepted_at
           FROM portal_client_memberships pcm
           JOIN portal_client_users pcu ON pcu.id = pcm.client_user_id
          WHERE pcm.team_id = $1::UUID AND pcm.client_id = $2::UUID
          ORDER BY pcm.role, pcu.name`,
        [teamId, clientId],
      ),
    ]);
    return res.send(new ServerResponse(true, {
      ...client,
      assigned_projects_count: projects.rowCount || 0,
      projects: projects.rows,
      team_members: members.rows,
    }));
  }

  public static async createClient(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const staff = actor(req);
    const name = text(req.body?.name, 60);
    const email = String(req.body?.email || "").trim().toLowerCase();
    const companyName = text(req.body?.company_name, 120);
    const contactPerson = text(req.body?.contact_person, 120);
    if (!name || !companyName || !contactPerson || !isValidateEmail(email)) {
      return res.status(400).send(new ServerResponse(false, null, "Name, company, contact, and a valid email are required"));
    }
    const existing = await db.query(
      `SELECT c.id, c.name, c.email, c.company_name,
              EXISTS (SELECT 1 FROM portal_invitations pi WHERE pi.client_id = c.id AND pi.status = 'pending') AS invitation_sent
         FROM clients c WHERE c.team_id = $1::UUID AND lower(c.email::TEXT) = lower($2) LIMIT 1`,
      [staff.teamId, email],
    );
    if (existing.rowCount) {
      return res.send(new ServerResponse(true, {
        ...existing.rows[0], existing: true, invitationAlreadySent: existing.rows[0].invitation_sent,
      }));
    }
    const inserted = await db.query(
      `INSERT INTO clients
         (name, team_id, email, company_name, contact_person, phone, phone_country_code,
          address_line_1, city, state, zip_code, country, status, client_portal_enabled)
       VALUES ($1, $2::UUID, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', TRUE)
       RETURNING *`,
      [
        name, staff.teamId, email, companyName, contactPerson,
        text(req.body?.phone, 40), text(req.body?.phone_country_code, 8),
        text(req.body?.address_line_1, 255), text(req.body?.city, 100),
        text(req.body?.state, 100), text(req.body?.zip_code, 30), text(req.body?.country, 100),
      ],
    );
    const client = inserted.rows[0];
    const invitation = await createPortalInvitation({
      teamId: staff.teamId,
      clientId: client.id,
      email,
      name: contactPerson,
      role: "admin",
      accessLevel: "view",
      invitedBy: staff.userId,
      inviterName: staff.name,
    });
    await auditPortalEvent({ action: "client.created", staffUserId: staff.userId, teamId: staff.teamId, clientId: client.id, details: { invitationId: invitation.invitationId }, req });
    return res.status(201).send(new ServerResponse(true, { ...client, invitation }, "Client created"));
  }

  public static async updateClient(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const staff = actor(req);
    const clientId = String(req.params.clientId || "");
    if (!UUID_PATTERN.test(clientId) || !(await clientInTeam(clientId, staff.teamId))) {
      return res.status(404).send(new ServerResponse(false, null, "Client not found"));
    }
    const status = ["active", "inactive", "pending"].includes(String(req.body?.status)) ? String(req.body.status) : null;
    const email = req.body?.email === undefined ? null : String(req.body.email).trim().toLowerCase();
    if (email !== null && !isValidateEmail(email)) return res.status(400).send(new ServerResponse(false, null, "Invalid email"));
    const result = await db.query(
      `UPDATE clients SET
         name = COALESCE($3, name), email = COALESCE($4, email), company_name = COALESCE($5, company_name),
         contact_person = COALESCE($6, contact_person), phone = COALESCE($7, phone),
         phone_country_code = COALESCE($8, phone_country_code), address_line_1 = COALESCE($9, address_line_1),
         city = COALESCE($10, city), state = COALESCE($11, state), zip_code = COALESCE($12, zip_code),
         country = COALESCE($13, country), status = COALESCE($14, status), updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::UUID AND team_id = $2::UUID RETURNING *`,
      [
        clientId, staff.teamId, text(req.body?.name, 60), email, text(req.body?.company_name, 120),
        text(req.body?.contact_person, 120), text(req.body?.phone, 40), text(req.body?.phone_country_code, 8),
        text(req.body?.address_line_1, 255), text(req.body?.city, 100), text(req.body?.state, 100),
        text(req.body?.zip_code, 30), text(req.body?.country, 100), status,
      ],
    );
    return res.send(new ServerResponse(true, result.rows[0], "Client updated"));
  }

  public static async deactivateClient(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const staff = actor(req);
    const clientId = String(req.params.clientId || "");
    const result = await db.query(
      `UPDATE clients SET status = 'inactive', client_portal_enabled = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID AND team_id = $2::UUID RETURNING id`,
      [clientId, staff.teamId],
    );
    if (!result.rowCount) return res.status(404).send(new ServerResponse(false, null, "Client not found"));
    await db.query(
      `UPDATE portal_sessions ps SET revoked_at = CURRENT_TIMESTAMP
        FROM portal_client_memberships pcm
        WHERE ps.membership_id = pcm.id AND pcm.client_id = $1::UUID AND pcm.team_id = $2::UUID AND ps.revoked_at IS NULL`,
      [clientId, staff.teamId],
    );
    IO.getInstance()?.in(`portal:client:${staff.teamId}:${clientId}`).disconnectSockets(true);
    await auditPortalEvent({ action: "client.deactivated", staffUserId: staff.userId, teamId: staff.teamId, clientId, req });
    return res.send(new ServerResponse(true, null, "Client portal access disabled"));
  }

  public static async clientProjects(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const staff = actor(req);
    const clientId = String(req.params.clientId || "");
    if (!(await clientInTeam(clientId, staff.teamId))) return res.status(404).send(new ServerResponse(false, null, "Client not found"));
    const result = await db.query(
      `SELECT p.id, p.name, p.key, COALESCE(sps.name, 'Active') AS status,
              ppa.access_level, ppa.can_view_files, p.updated_at AS "lastUpdated",
              COUNT(t.id)::INT AS "totalTasks",
              COUNT(t.id) FILTER (WHERE stc.is_done = TRUE)::INT AS "completedTasks",
              '[]'::JSONB AS members
         FROM portal_project_access ppa
         JOIN projects p ON p.id = ppa.project_id AND p.team_id = ppa.team_id
         LEFT JOIN sys_project_statuses sps ON sps.id = p.status_id
         LEFT JOIN tasks t ON t.project_id = p.id AND t.archived = FALSE
         LEFT JOIN task_statuses ts ON ts.id = t.status_id
         LEFT JOIN sys_task_status_categories stc ON stc.id = ts.category_id
        WHERE ppa.team_id = $1::UUID AND ppa.client_id = $2::UUID
        GROUP BY p.id, sps.name, ppa.access_level, ppa.can_view_files
        ORDER BY p.name`,
      [staff.teamId, clientId],
    );
    return res.send(new ServerResponse(true, { projects: result.rows, total: result.rowCount || 0, page: 1, limit: 100 }));
  }

  public static async assignProject(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const staff = actor(req);
    const clientId = String(req.params.clientId || "");
    const projectId = String(req.body?.project_id || "");
    const accessLevel = req.body?.access_level === "comment" ? "comment" : "view";
    const canViewFiles = req.body?.can_view_files !== false;
    if (!UUID_PATTERN.test(clientId) || !UUID_PATTERN.test(projectId)) return res.status(400).send(new ServerResponse(false, null, "Invalid assignment"));
    const scope = await db.query(
      `SELECT c.id FROM clients c JOIN projects p ON p.team_id = c.team_id
        WHERE c.id = $1::UUID AND p.id = $2::UUID AND c.team_id = $3::UUID`,
      [clientId, projectId, staff.teamId],
    );
    if (!scope.rowCount) return res.status(404).send(new ServerResponse(false, null, "Client or project not found"));
    await db.query(
      `WITH granted AS (
         INSERT INTO portal_project_access
           (team_id, client_id, project_id, access_level, can_view_files, created_by)
         VALUES ($1::UUID, $2::UUID, $3::UUID, $4, $5, $6::UUID)
         ON CONFLICT (project_id)
         DO UPDATE SET client_id = EXCLUDED.client_id, team_id = EXCLUDED.team_id,
                       access_level = EXCLUDED.access_level, can_view_files = EXCLUDED.can_view_files,
                       created_by = EXCLUDED.created_by, updated_at = CURRENT_TIMESTAMP
         RETURNING project_id
       )
       UPDATE projects
          SET client_id = $2::UUID, client_portal_visible = TRUE,
              client_portal_access_level = $4, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3::UUID AND team_id = $1::UUID
          AND id IN (SELECT project_id FROM granted)`,
      [staff.teamId, clientId, projectId, accessLevel, canViewFiles, staff.userId],
    );
    const io = IO.getInstance();
    io?.in(`portal:project:${projectId}`).socketsLeave(`portal:project:${projectId}`);
    io?.in(`portal:client:${staff.teamId}:${clientId}`).socketsJoin(`portal:project:${projectId}`);
    await auditPortalEvent({ action: "project.access.granted", staffUserId: staff.userId, teamId: staff.teamId, clientId, details: { projectId, accessLevel, canViewFiles }, req });
    return res.status(201).send(new ServerResponse(true, { project_id: projectId, access_level: accessLevel, can_view_files: canViewFiles }, "Project assigned"));
  }

  public static async removeProject(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const staff = actor(req);
    const clientId = String(req.params.clientId || "");
    const projectId = String(req.params.projectId || "");
    const result = await db.query(
      `DELETE FROM portal_project_access
        WHERE team_id = $1::UUID AND client_id = $2::UUID AND project_id = $3::UUID RETURNING id`,
      [staff.teamId, clientId, projectId],
    );
    if (!result.rowCount) return res.status(404).send(new ServerResponse(false, null, "Project assignment not found"));
    await db.query(
      `UPDATE projects SET client_id = NULL, client_portal_visible = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID AND team_id = $2::UUID AND client_id = $3::UUID`,
      [projectId, staff.teamId, clientId],
    );
    IO.getInstance()?.in(`portal:project:${projectId}`).socketsLeave(`portal:project:${projectId}`);
    await auditPortalEvent({ action: "project.access.revoked", staffUserId: staff.userId, teamId: staff.teamId, clientId, details: { projectId }, req });
    return res.send(new ServerResponse(true, null, "Project removed"));
  }

  public static async clientTeam(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const staff = actor(req);
    const clientId = String(req.params.clientId || "");
    if (!(await clientInTeam(clientId, staff.teamId))) return res.status(404).send(new ServerResponse(false, null, "Client not found"));
    const result = await db.query(
      `SELECT pcu.id, pcu.name, pcu.email, pcm.role, pcm.access_level,
              CASE WHEN pcm.is_active THEN 'active' ELSE 'inactive' END AS status,
              pcm.accepted_at
         FROM portal_client_memberships pcm
         JOIN portal_client_users pcu ON pcu.id = pcm.client_user_id
        WHERE pcm.team_id = $1::UUID AND pcm.client_id = $2::UUID
        ORDER BY pcm.role, pcu.name`,
      [staff.teamId, clientId],
    );
    return res.send(new ServerResponse(true, { team_members: result.rows, total: result.rowCount || 0, page: 1, limit: 100 }));
  }

  public static async inviteTeamMember(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const staff = actor(req);
    const clientId = String(req.params.clientId || "");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = text(req.body?.name, 120);
    if (!UUID_PATTERN.test(clientId) || !name || !isValidateEmail(email) || !(await clientInTeam(clientId, staff.teamId))) {
      return res.status(400).send(new ServerResponse(false, null, "Valid client, name, and email are required"));
    }
    const invitation = await createPortalInvitation({
      teamId: staff.teamId, clientId, email, name,
      role: req.body?.role === "admin" ? "admin" : "member",
      accessLevel: req.body?.access_level === "comment" ? "comment" : "view",
      invitedBy: staff.userId, inviterName: staff.name,
    });
    return res.status(201).send(new ServerResponse(true, invitation, "Invitation created"));
  }

  public static async updateTeamMember(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const staff = actor(req);
    const clientId = String(req.params.clientId || "");
    const memberId = String(req.params.memberId || "");
    const result = await db.query(
      `UPDATE portal_client_memberships pcm SET
         role = COALESCE($4, role), access_level = COALESCE($5, access_level),
         is_active = COALESCE($6, is_active), updated_at = CURRENT_TIMESTAMP
       FROM portal_client_users pcu
       WHERE pcm.client_user_id = pcu.id AND pcm.team_id = $1::UUID AND pcm.client_id = $2::UUID
         AND pcu.id = $3::UUID
       RETURNING pcu.id, pcu.name, pcu.email, pcm.id AS membership_id,
                 pcm.role, pcm.access_level, pcm.is_active`,
      [
        staff.teamId, clientId, memberId,
        ["admin", "member"].includes(String(req.body?.role)) ? req.body.role : null,
        ["view", "comment"].includes(String(req.body?.access_level)) ? req.body.access_level : null,
        typeof req.body?.is_active === "boolean" ? req.body.is_active : null,
      ],
    );
    if (!result.rowCount) return res.status(404).send(new ServerResponse(false, null, "Client member not found"));
    if (req.body?.is_active === false) {
      await db.query(
        `UPDATE portal_sessions ps SET revoked_at = CURRENT_TIMESTAMP
          FROM portal_client_memberships pcm
          WHERE ps.membership_id = pcm.id AND pcm.client_user_id = $1::UUID
            AND pcm.team_id = $2::UUID AND pcm.client_id = $3::UUID AND ps.revoked_at IS NULL`,
        [memberId, staff.teamId, clientId],
      );
      IO.getInstance()?.in(`portal:membership:${result.rows[0].membership_id}`).disconnectSockets(true);
    }
    return res.send(new ServerResponse(true, result.rows[0], "Client member updated"));
  }

  public static async removeTeamMember(req: IWorkLenzRequest, res: Response): Promise<Response> {
    req.body = { ...(req.body || {}), is_active: false };
    return ClientPortalAdminController.updateTeamMember(req, res);
  }

  public static async resendTeamInvitation(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const staff = actor(req);
    const clientId = String(req.params.clientId || "");
    const memberId = String(req.params.memberId || "");
    const result = await db.query(
      `SELECT pcu.name, pcu.email, pcm.role, pcm.access_level
         FROM portal_client_memberships pcm
         JOIN portal_client_users pcu ON pcu.id = pcm.client_user_id
        WHERE pcm.team_id = $1::UUID AND pcm.client_id = $2::UUID
          AND pcu.id = $3::UUID AND pcm.accepted_at IS NULL
        LIMIT 1`,
      [staff.teamId, clientId, memberId],
    );
    if (!result.rowCount) {
      return res.status(404).send(new ServerResponse(false, null, "Pending client member not found"));
    }
    const member = result.rows[0];
    const invitation = await createPortalInvitation({
      teamId: staff.teamId,
      clientId,
      email: member.email,
      name: member.name,
      role: member.role,
      accessLevel: member.access_level,
      invitedBy: staff.userId,
      inviterName: staff.name,
    });
    return res.send(new ServerResponse(true, invitation, "Invitation resent"));
  }

  public static async generateInvitation(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const staff = actor(req);
    const clientId = String(req.body?.clientId || req.params.clientId || "");
    const client = await clientInTeam(clientId, staff.teamId);
    if (!client?.email) return res.status(404).send(new ServerResponse(false, null, "Client email not found"));
    const invitation = await createPortalInvitation({
      teamId: staff.teamId, clientId, email: client.email,
      name: client.contact_person || client.name, role: "admin", accessLevel: "view",
      invitedBy: staff.userId, inviterName: staff.name,
    });
    return res.send(new ServerResponse(true, {
      ...invitation, clientName: client.company_name || client.name, clientEmail: client.email,
    }, "Invitation created"));
  }

  public static async staffComments(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const staff = actor(req);
    const projectId = String(req.params.projectId || "");
    const taskId = String(req.params.taskId || "");
    const scope = await db.query(
      `SELECT ppa.client_id FROM portal_project_access ppa JOIN tasks t ON t.project_id = ppa.project_id
        WHERE ppa.team_id = $1::UUID AND ppa.project_id = $2::UUID AND t.id = $3::UUID LIMIT 1`,
      [staff.teamId, projectId, taskId],
    );
    if (!scope.rowCount) return res.status(404).send(new ServerResponse(false, null, "Portal task not found"));
    const result = await db.query(
      `SELECT id, sender_type, sender_name, comment, created_at, updated_at
         FROM portal_task_comments WHERE team_id = $1::UUID AND project_id = $2::UUID AND task_id = $3::UUID
        ORDER BY created_at, id`,
      [staff.teamId, projectId, taskId],
    );
    return res.send(new ServerResponse(true, { comments: result.rows, total: result.rowCount || 0 }));
  }

  public static async addStaffComment(req: IWorkLenzRequest, res: Response): Promise<Response> {
    const staff = actor(req);
    const projectId = String(req.params.projectId || "");
    const taskId = String(req.params.taskId || "");
    const comment = String(req.body?.comment || "").trim();
    if (!comment || comment.length > 5000) return res.status(400).send(new ServerResponse(false, null, "Comment must be between 1 and 5000 characters"));
    const scope = await db.query(
      `SELECT ppa.client_id FROM portal_project_access ppa JOIN tasks t ON t.project_id = ppa.project_id
        WHERE ppa.team_id = $1::UUID AND ppa.project_id = $2::UUID AND t.id = $3::UUID LIMIT 1`,
      [staff.teamId, projectId, taskId],
    );
    if (!scope.rowCount) return res.status(404).send(new ServerResponse(false, null, "Portal task not found"));
    const inserted = await db.query(
      `INSERT INTO portal_task_comments
         (team_id, client_id, project_id, task_id, staff_user_id, sender_type, sender_name, comment)
       VALUES ($1::UUID, $2::UUID, $3::UUID, $4::UUID, $5::UUID, 'staff', $6, $7)
       RETURNING id, sender_type, sender_name, comment, created_at, updated_at`,
      [staff.teamId, scope.rows[0].client_id, projectId, taskId, staff.userId, staff.name, comment],
    );
    IO.getInstance()?.to(`portal:project:${projectId}`).emit("portal:task-comment", {
      projectId,
      taskId,
      comment: inserted.rows[0],
    });
    IO.getInstance()?.to(projectId).emit("portal:task-comment", {
      projectId,
      taskId,
      comment: inserted.rows[0],
    });
    await auditPortalEvent({
      action: "task.comment.created_by_staff",
      staffUserId: staff.userId,
      teamId: staff.teamId,
      clientId: scope.rows[0].client_id,
      details: { projectId, taskId, commentId: inserted.rows[0].id },
      req,
    });
    return res.status(201).send(new ServerResponse(true, inserted.rows[0], "Comment added"));
  }
}
