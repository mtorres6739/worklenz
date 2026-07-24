import crypto from "crypto";
import { Response } from "express";

import db from "../config/db";
import { IWorkLenzRequest } from "../interfaces/worklenz-request";
import { ServerResponse } from "../models/server-response";
import { auditPortalEvent } from "../services/client-portal-session.service";
import { scanPortalAttachment } from "../services/malware-scanner.service";
import {
  createPresignedViewUrl,
  deleteObject,
  getClientPortalStorageKey,
  uploadBuffer,
} from "../shared/storage";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE_STATUSES = new Set(["active", "inactive", "draft"]);
const REQUEST_STATUSES = new Set([
  "pending",
  "accepted",
  "in_progress",
  "waiting_on_client",
  "completed",
  "rejected",
  "cancelled",
]);

function staffActor(req: IWorkLenzRequest) {
  if (!req.user?.id || !req.user?.team_id) {
    throw new Error("Missing staff session scope");
  }
  return {
    userId: req.user.id,
    teamId: req.user.team_id,
    name: req.user.name || "SDM team",
  };
}

function normalizedText(value: unknown, max: number): string | null {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function pageOptions(req: IWorkLenzRequest) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
}

function serviceData(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 64 * 1024) return null;
  return value as Record<string, unknown>;
}

function clientIds(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > 1000) return [];
  return [...new Set(value.map(String))].filter((id) => UUID_PATTERN.test(id));
}

function serviceKey(name: string, requested?: unknown): string {
  const explicit = String(requested || "")
    .trim()
    .toUpperCase();
  if (/^[A-Z0-9]{2,8}$/.test(explicit)) return explicit;
  const base = name
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 4);
  const prefix = (base.length >= 2 ? base : `${base}SV`).slice(0, 4);
  return `${prefix}${crypto.randomBytes(2).toString("hex").toUpperCase()}`.slice(
    0,
    8,
  );
}

async function assertClientsInTeam(
  ids: string[],
  teamId: string,
): Promise<boolean> {
  if (!ids.length) return true;
  const result = await db.query(
    `SELECT COUNT(*)::INT AS count
       FROM clients
      WHERE team_id = $1::UUID AND id = ANY($2::UUID[])`,
    [teamId, ids],
  );
  return Number(result.rows[0]?.count || 0) === ids.length;
}

async function staffRequest(
  requestId: string,
  teamId: string,
): Promise<Record<string, unknown> | null> {
  const result = await db.query(
    `SELECT pr.*, pr.request_no AS req_no, ps.name AS service_name,
            ps.description AS service_description, c.name AS client_name,
            c.email AS client_email, u.name AS assigned_to_name
       FROM portal_requests pr
       JOIN portal_services ps
         ON ps.id = pr.service_id AND ps.team_id = pr.team_id
       JOIN clients c ON c.id = pr.client_id AND c.team_id = pr.team_id
       LEFT JOIN users u ON u.id = pr.assigned_to
      WHERE pr.id = $1::UUID AND pr.team_id = $2::UUID
      LIMIT 1`,
    [requestId, teamId],
  );
  return result.rows[0] || null;
}

export default class ClientPortalServicesRequestsAdminController {
  public static async listServices(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const { teamId } = staffActor(req);
    const { page, limit, offset } = pageOptions(req);
    const search = String(req.query.search || "").trim();
    const status = SERVICE_STATUSES.has(String(req.query.status))
      ? String(req.query.status)
      : null;
    const result = await db.query(
      `SELECT ps.id, ps.name, ps.description, ps.service_key, ps.status,
              ps.service_data, ps.is_public, ps.price, ps.currency, ps.category,
              ps.created_at, ps.updated_at,
              MAX(u.name) AS created_by_name,
              COUNT(DISTINCT psc.client_id)::INT AS allowed_clients_count,
              COUNT(DISTINCT pr.id)::INT AS requests_count,
              COUNT(*) OVER()::INT AS full_count
         FROM portal_services ps
         LEFT JOIN users u ON u.id = ps.created_by
         LEFT JOIN portal_service_clients psc
           ON psc.service_id = ps.id AND psc.team_id = ps.team_id
         LEFT JOIN portal_requests pr
           ON pr.service_id = ps.id AND pr.team_id = ps.team_id
        WHERE ps.team_id = $1::UUID
          AND ($2 = '' OR ps.name ILIKE '%' || $2 || '%'
            OR COALESCE(ps.description, '') ILIKE '%' || $2 || '%')
          AND ($3::TEXT IS NULL OR ps.status = $3)
        GROUP BY ps.id
        ORDER BY ps.updated_at DESC, ps.name
        LIMIT $4 OFFSET $5`,
      [teamId, search, status, limit, offset],
    );
    return res.send(
      new ServerResponse(true, {
        data: result.rows,
        total: result.rows[0]?.full_count || 0,
        page,
        limit,
      }),
    );
  }

  public static async getService(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const { teamId } = staffActor(req);
    const id = String(req.params.id || "");
    if (!UUID_PATTERN.test(id)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid service"));
    }
    const result = await db.query(
      `SELECT ps.*,
              COALESCE(
                jsonb_agg(
                  DISTINCT jsonb_build_object('id', c.id, 'name', c.name)
                ) FILTER (WHERE c.id IS NOT NULL),
                '[]'::JSONB
              ) AS allowed_clients
         FROM portal_services ps
         LEFT JOIN portal_service_clients psc
           ON psc.service_id = ps.id AND psc.team_id = ps.team_id
         LEFT JOIN clients c
           ON c.id = psc.client_id AND c.team_id = psc.team_id
        WHERE ps.id = $1::UUID AND ps.team_id = $2::UUID
        GROUP BY ps.id`,
      [id, teamId],
    );
    if (!result.rowCount) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Service not found"));
    }
    return res.send(new ServerResponse(true, result.rows[0]));
  }

  public static async createService(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const name = normalizedText(req.body?.name, 120);
    const description = normalizedText(req.body?.description, 10000);
    const data = serviceData(req.body?.service_data || {});
    const allowedClientIds = clientIds(req.body?.allowed_client_ids) || [];
    const price =
      req.body?.price === null || req.body?.price === undefined
        ? null
        : Number(req.body.price);
    const currency = String(req.body?.currency || "USD")
      .trim()
      .toUpperCase();
    const status = SERVICE_STATUSES.has(String(req.body?.status))
      ? String(req.body.status)
      : "active";
    if (
      !name ||
      !data ||
      allowedClientIds.length !== (req.body?.allowed_client_ids?.length || 0) ||
      (price !== null && (!Number.isFinite(price) || price < 0)) ||
      !/^[A-Z]{3}$/.test(currency)
    ) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid service configuration"));
    }
    if (!(await assertClientsInTeam(allowedClientIds, staff.teamId))) {
      return res
        .status(400)
        .send(
          new ServerResponse(false, null, "One or more clients are invalid"),
        );
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO portal_services
           (team_id, created_by, name, description, service_key, status,
            service_data, is_public, price, currency, category)
         VALUES ($1::UUID, $2::UUID, $3, $4, $5, $6, $7::JSONB, $8, $9, $10, $11)
         RETURNING *`,
        [
          staff.teamId,
          staff.userId,
          name,
          description,
          serviceKey(name, req.body?.service_key),
          status,
          JSON.stringify(data),
          req.body?.is_public === true,
          price,
          currency,
          normalizedText(req.body?.category, 120),
        ],
      );
      for (const clientId of allowedClientIds) {
        await client.query(
          `INSERT INTO portal_service_clients (service_id, team_id, client_id)
           VALUES ($1::UUID, $2::UUID, $3::UUID)`,
          [inserted.rows[0].id, staff.teamId, clientId],
        );
      }
      await client.query("COMMIT");
      await auditPortalEvent({
        action: "service.created",
        staffUserId: staff.userId,
        teamId: staff.teamId,
        details: { serviceId: inserted.rows[0].id },
        req,
      });
      return res
        .status(201)
        .send(new ServerResponse(true, inserted.rows[0], "Service created"));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public static async updateService(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const id = String(req.params.id || "");
    if (!UUID_PATTERN.test(id)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid service"));
    }
    const existing = await db.query(
      `SELECT * FROM portal_services
        WHERE id = $1::UUID AND team_id = $2::UUID`,
      [id, staff.teamId],
    );
    if (!existing.rowCount) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Service not found"));
    }
    const current = existing.rows[0];
    const name = normalizedText(req.body?.name ?? current.name, 120);
    const data = serviceData(req.body?.service_data ?? current.service_data);
    const allowedClientIds = clientIds(req.body?.allowed_client_ids);
    const status = String(req.body?.status ?? current.status);
    const currency = String(req.body?.currency ?? current.currency)
      .trim()
      .toUpperCase();
    const price =
      req.body?.price === undefined
        ? current.price
        : req.body.price === null
          ? null
          : Number(req.body.price);
    if (
      !name ||
      !data ||
      !SERVICE_STATUSES.has(status) ||
      !/^[A-Z]{3}$/.test(currency) ||
      (price !== null &&
        (!Number.isFinite(Number(price)) || Number(price) < 0)) ||
      (allowedClientIds !== null &&
        allowedClientIds.length !== (req.body?.allowed_client_ids?.length || 0))
    ) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid service configuration"));
    }
    if (
      allowedClientIds !== null &&
      !(await assertClientsInTeam(allowedClientIds, staff.teamId))
    ) {
      return res
        .status(400)
        .send(
          new ServerResponse(false, null, "One or more clients are invalid"),
        );
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE portal_services
            SET name = $3, description = $4, status = $5, service_data = $6::JSONB,
                is_public = $7, price = $8, currency = $9, category = $10,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::UUID AND team_id = $2::UUID
          RETURNING *`,
        [
          id,
          staff.teamId,
          name,
          req.body?.description === undefined
            ? current.description
            : normalizedText(req.body.description, 10000),
          status,
          JSON.stringify(data),
          req.body?.is_public === undefined
            ? current.is_public
            : req.body.is_public === true,
          price,
          currency,
          req.body?.category === undefined
            ? current.category
            : normalizedText(req.body.category, 120),
        ],
      );
      if (allowedClientIds !== null) {
        await client.query(
          `DELETE FROM portal_service_clients
            WHERE service_id = $1::UUID AND team_id = $2::UUID`,
          [id, staff.teamId],
        );
        for (const clientId of allowedClientIds) {
          await client.query(
            `INSERT INTO portal_service_clients (service_id, team_id, client_id)
             VALUES ($1::UUID, $2::UUID, $3::UUID)`,
            [id, staff.teamId, clientId],
          );
        }
      }
      await client.query("COMMIT");
      await auditPortalEvent({
        action: "service.updated",
        staffUserId: staff.userId,
        teamId: staff.teamId,
        details: { serviceId: id },
        req,
      });
      return res.send(
        new ServerResponse(true, updated.rows[0], "Service updated"),
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public static async deactivateService(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const id = String(req.params.id || "");
    if (!UUID_PATTERN.test(id)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid service"));
    }
    const result = await db.query(
      `UPDATE portal_services
          SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID AND team_id = $2::UUID
        RETURNING id`,
      [id, staff.teamId],
    );
    if (!result.rowCount) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Service not found"));
    }
    await auditPortalEvent({
      action: "service.deactivated",
      staffUserId: staff.userId,
      teamId: staff.teamId,
      details: { serviceId: id },
      req,
    });
    return res.send(new ServerResponse(true, { id }, "Service deactivated"));
  }

  public static async listRequests(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const { teamId } = staffActor(req);
    const { page, limit, offset } = pageOptions(req);
    const search = String(req.query.search || "").trim();
    const status = REQUEST_STATUSES.has(String(req.query.status))
      ? String(req.query.status)
      : null;
    const clientId = UUID_PATTERN.test(String(req.query.client_id || ""))
      ? String(req.query.client_id)
      : null;
    const serviceId = UUID_PATTERN.test(String(req.query.service_id || ""))
      ? String(req.query.service_id)
      : null;
    const assignedTo = UUID_PATTERN.test(String(req.query.assigned_to || ""))
      ? String(req.query.assigned_to)
      : null;
    const result = await db.query(
      `SELECT pr.*, pr.request_no AS req_no, ps.name AS service_name,
              ps.description AS service_description, c.name AS client_name,
              c.email AS client_email, u.name AS assigned_to_name,
              COUNT(*) OVER()::INT AS full_count
         FROM portal_requests pr
         JOIN portal_services ps
           ON ps.id = pr.service_id AND ps.team_id = pr.team_id
         JOIN clients c ON c.id = pr.client_id AND c.team_id = pr.team_id
         LEFT JOIN users u ON u.id = pr.assigned_to
        WHERE pr.team_id = $1::UUID
          AND ($2 = '' OR pr.request_no ILIKE '%' || $2 || '%'
            OR c.name ILIKE '%' || $2 || '%' OR ps.name ILIKE '%' || $2 || '%')
          AND ($3::TEXT IS NULL OR pr.status = $3)
          AND ($4::UUID IS NULL OR pr.client_id = $4::UUID)
          AND ($5::UUID IS NULL OR pr.service_id = $5::UUID)
          AND ($6::UUID IS NULL OR pr.assigned_to = $6::UUID)
        ORDER BY pr.updated_at DESC, pr.request_number DESC
        LIMIT $7 OFFSET $8`,
      [teamId, search, status, clientId, serviceId, assignedTo, limit, offset],
    );
    return res.send(
      new ServerResponse(true, {
        requests: result.rows,
        total: result.rows[0]?.full_count || 0,
        page,
        limit,
      }),
    );
  }

  public static async requestStats(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const { teamId } = staffActor(req);
    const result = await db.query(
      `SELECT COUNT(*)::INT AS total,
              COUNT(*) FILTER (WHERE status = 'pending')::INT AS pending,
              COUNT(*) FILTER (WHERE status IN ('accepted', 'in_progress', 'waiting_on_client'))::INT AS active,
              COUNT(*) FILTER (WHERE status = 'completed')::INT AS completed,
              COUNT(*) FILTER (WHERE status IN ('rejected', 'cancelled'))::INT AS closed
         FROM portal_requests
        WHERE team_id = $1::UUID`,
      [teamId],
    );
    return res.send(new ServerResponse(true, result.rows[0]));
  }

  public static async getRequest(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const { teamId } = staffActor(req);
    const id = String(req.params.id || "");
    if (!UUID_PATTERN.test(id)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid request"));
    }
    const request = await staffRequest(id, teamId);
    if (!request) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Request not found"));
    }
    return res.send(new ServerResponse(true, request));
  }

  public static async updateRequestStatus(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const id = String(req.params.id || "");
    const status = String(req.body?.status || "");
    const notes = normalizedText(req.body?.notes, 10000);
    if (!UUID_PATTERN.test(id) || !REQUEST_STATUSES.has(status)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid request status"));
    }
    const existing = await staffRequest(id, staff.teamId);
    if (!existing) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Request not found"));
    }
    const assignedTo = req.body?.assigned_to;
    if (assignedTo && !UUID_PATTERN.test(String(assignedTo))) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid assignee"));
    }
    if (assignedTo) {
      const member = await db.query(
        `SELECT 1
           FROM team_members
          WHERE team_id = $1::UUID AND user_id = $2::UUID
          LIMIT 1`,
        [staff.teamId, assignedTo],
      );
      if (!member.rowCount) {
        return res
          .status(400)
          .send(
            new ServerResponse(false, null, "Assignee is not in this team"),
          );
      }
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE portal_requests
            SET status = $3,
                notes = COALESCE($4, notes),
                assigned_to = COALESCE($5::UUID, assigned_to),
                accepted_at = CASE WHEN $3 = 'accepted' THEN CURRENT_TIMESTAMP ELSE accepted_at END,
                completed_at = CASE WHEN $3 = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,
                rejected_at = CASE WHEN $3 = 'rejected' THEN CURRENT_TIMESTAMP ELSE rejected_at END,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::UUID AND team_id = $2::UUID
          RETURNING *`,
        [id, staff.teamId, status, notes, assignedTo || null],
      );
      await client.query(
        `INSERT INTO portal_request_status_history
           (request_id, team_id, client_id, from_status, to_status,
            changed_by_staff_user_id, notes)
         VALUES ($1::UUID, $2::UUID, $3::UUID, $4, $5, $6::UUID, $7)`,
        [
          id,
          staff.teamId,
          existing.client_id,
          existing.status,
          status,
          staff.userId,
          notes,
        ],
      );
      await client.query("COMMIT");
      await auditPortalEvent({
        action: "request.status.updated",
        staffUserId: staff.userId,
        teamId: staff.teamId,
        clientId: String(existing.client_id),
        details: { requestId: id, from: existing.status, to: status },
        req,
      });
      return res.send(
        new ServerResponse(true, updated.rows[0], "Request status updated"),
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public static async assignRequest(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const id = String(req.params.id || "");
    const assignedTo = String(req.body?.assigned_to || "");
    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(assignedTo)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid request assignment"));
    }
    const result = await db.query(
      `UPDATE portal_requests pr
          SET assigned_to = $3::UUID, updated_at = CURRENT_TIMESTAMP
        WHERE pr.id = $1::UUID AND pr.team_id = $2::UUID
          AND EXISTS (
            SELECT 1 FROM team_members tm
             WHERE tm.team_id = pr.team_id AND tm.user_id = $3::UUID
          )
        RETURNING pr.*`,
      [id, staff.teamId, assignedTo],
    );
    if (!result.rowCount) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Request or assignee not found"));
    }
    await auditPortalEvent({
      action: "request.assigned",
      staffUserId: staff.userId,
      teamId: staff.teamId,
      clientId: result.rows[0].client_id,
      details: { requestId: id, assignedTo },
      req,
    });
    return res.send(
      new ServerResponse(true, result.rows[0], "Request assigned"),
    );
  }

  public static async comments(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const { teamId } = staffActor(req);
    const id = String(req.params.id || "");
    if (!UUID_PATTERN.test(id) || !(await staffRequest(id, teamId))) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Request not found"));
    }
    const result = await db.query(
      `SELECT prc.id, prc.comment,
              CASE WHEN prc.sender_type = 'staff' THEN 'team_member'
                   ELSE 'client' END AS sender_type,
              COALESCE(prc.staff_user_id, prc.membership_id) AS sender_id,
              prc.sender_name, prc.created_at, prc.updated_at
         FROM portal_request_comments prc
        WHERE prc.request_id = $1::UUID AND prc.team_id = $2::UUID
        ORDER BY prc.created_at, prc.id`,
      [id, teamId],
    );
    return res.send(
      new ServerResponse(true, {
        comments: result.rows,
        totalCount: result.rowCount || 0,
        newCommentsCount: 0,
      }),
    );
  }

  public static async addComment(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const id = String(req.params.id || "");
    const comment = normalizedText(req.body?.comment, 5000);
    if (!UUID_PATTERN.test(id) || !comment) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "A valid comment is required"));
    }
    const request = await staffRequest(id, staff.teamId);
    if (!request) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Request not found"));
    }
    const result = await db.query(
      `INSERT INTO portal_request_comments
         (request_id, team_id, client_id, staff_user_id, sender_type,
          sender_name, comment)
       VALUES ($1::UUID, $2::UUID, $3::UUID, $4::UUID, 'staff', $5, $6)
       RETURNING id, comment, 'team_member'::TEXT AS sender_type,
                 staff_user_id AS sender_id, sender_name, created_at, updated_at`,
      [id, staff.teamId, request.client_id, staff.userId, staff.name, comment],
    );
    await auditPortalEvent({
      action: "request.comment.created",
      staffUserId: staff.userId,
      teamId: staff.teamId,
      clientId: String(request.client_id),
      details: { requestId: id, commentId: result.rows[0].id },
      req,
    });
    return res
      .status(201)
      .send(new ServerResponse(true, result.rows[0], "Comment added"));
  }

  public static async attachments(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const { teamId } = staffActor(req);
    const id = String(req.params.id || "");
    if (!UUID_PATTERN.test(id) || !(await staffRequest(id, teamId))) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Request not found"));
    }
    const result = await db.query(
      `SELECT id, file_name AS name, mime_type, size, sender_type, created_at
         FROM portal_request_attachments
        WHERE request_id = $1::UUID AND team_id = $2::UUID
        ORDER BY created_at, id`,
      [id, teamId],
    );
    return res.send(
      new ServerResponse(true, {
        attachments: result.rows,
        total: result.rowCount || 0,
      }),
    );
  }

  public static async uploadAttachment(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const requestId = String(req.params.id || "");
    const file = req.file;
    const meta = req.portalRequestFileMeta;
    if (!UUID_PATTERN.test(requestId) || !file || !meta) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid attachment"));
    }
    const request = await staffRequest(requestId, staff.teamId);
    if (!request) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Request not found"));
    }

    const scan = await scanPortalAttachment(file.buffer);
    if (scan.status === "infected") {
      await auditPortalEvent({
        action: "request.attachment.blocked",
        staffUserId: staff.userId,
        teamId: staff.teamId,
        clientId: String(request.client_id),
        details: { requestId, reason: "malware_detected" },
        req,
      });
      return res
        .status(400)
        .send(new ServerResponse(false, null, "The attachment was blocked"));
    }
    if (scan.status !== "clean") {
      return res
        .status(503)
        .send(
          new ServerResponse(
            false,
            null,
            "Attachment scanning is temporarily unavailable",
          ),
        );
    }

    const attachmentId = crypto.randomUUID();
    const clientId = String(request.client_id);
    const objectKey = getClientPortalStorageKey(
      "request-attachments",
      staff.teamId,
      clientId,
      requestId,
      `${attachmentId}.${meta.extension}`,
    );
    const uploaded = await uploadBuffer(file.buffer, meta.mimeType, objectKey);
    if (!uploaded) {
      return res
        .status(500)
        .send(new ServerResponse(false, null, "Attachment upload failed"));
    }

    try {
      const inserted = await db.query(
        `INSERT INTO portal_request_attachments
           (id, request_id, team_id, client_id, staff_user_id, sender_type,
            object_key, file_name, mime_type, size)
         VALUES ($1::UUID, $2::UUID, $3::UUID, $4::UUID, $5::UUID, 'staff',
                 $6, $7, $8, $9)
         RETURNING id, file_name AS name, mime_type, size, sender_type, created_at`,
        [
          attachmentId,
          requestId,
          staff.teamId,
          clientId,
          staff.userId,
          objectKey,
          meta.cleanFileName,
          meta.mimeType,
          file.size,
        ],
      );
      await auditPortalEvent({
        action: "request.attachment.uploaded",
        staffUserId: staff.userId,
        teamId: staff.teamId,
        clientId,
        details: { requestId, attachmentId },
        req,
      });
      return res
        .status(201)
        .send(
          new ServerResponse(true, inserted.rows[0], "Attachment uploaded"),
        );
    } catch (error) {
      await deleteObject(objectKey);
      throw error;
    }
  }

  public static async downloadAttachment(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const requestId = String(req.params.id || "");
    const attachmentId = String(req.params.attachmentId || "");
    if (!UUID_PATTERN.test(requestId) || !UUID_PATTERN.test(attachmentId)) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Attachment not found"));
    }
    const result = await db.query(
      `SELECT pra.id, pra.file_name, pra.object_key, pra.client_id
         FROM portal_request_attachments pra
         JOIN portal_requests pr
           ON pr.id = pra.request_id AND pr.team_id = pra.team_id
        WHERE pra.id = $1::UUID
          AND pra.request_id = $2::UUID
          AND pra.team_id = $3::UUID
        LIMIT 1`,
      [attachmentId, requestId, staff.teamId],
    );
    const attachment = result.rows[0];
    if (!attachment) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Attachment not found"));
    }
    const url = await createPresignedViewUrl(
      attachment.object_key,
      attachment.file_name,
      300,
    );
    await auditPortalEvent({
      action: "request.attachment.download.authorized",
      staffUserId: staff.userId,
      teamId: staff.teamId,
      clientId: attachment.client_id,
      details: { requestId, attachmentId },
      req,
    });
    return res.send(new ServerResponse(true, { url, expires_in: 300 }));
  }

  public static async deleteAttachment(
    req: IWorkLenzRequest,
    res: Response,
  ): Promise<Response> {
    const staff = staffActor(req);
    const requestId = String(req.params.id || "");
    const attachmentId = String(req.params.attachmentId || "");
    if (!UUID_PATTERN.test(requestId) || !UUID_PATTERN.test(attachmentId)) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Attachment not found"));
    }
    const attachment = await db.query(
      `SELECT object_key, client_id
         FROM portal_request_attachments
        WHERE id = $1::UUID
          AND request_id = $2::UUID
          AND team_id = $3::UUID`,
      [attachmentId, requestId, staff.teamId],
    );
    if (!attachment.rowCount) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Attachment not found"));
    }
    if (!(await deleteObject(attachment.rows[0].object_key))) {
      return res
        .status(503)
        .send(
          new ServerResponse(
            false,
            null,
            "Attachment storage is temporarily unavailable",
          ),
        );
    }
    const deleted = await db.query(
      `DELETE FROM portal_request_attachments
        WHERE id = $1::UUID
          AND request_id = $2::UUID
          AND team_id = $3::UUID
        RETURNING id`,
      [attachmentId, requestId, staff.teamId],
    );
    if (!deleted.rowCount) {
      return res
        .status(409)
        .send(
          new ServerResponse(false, null, "Attachment changed during deletion"),
        );
    }
    await auditPortalEvent({
      action: "request.attachment.deleted",
      staffUserId: staff.userId,
      teamId: staff.teamId,
      clientId: attachment.rows[0].client_id,
      details: { requestId, attachmentId },
      req,
    });
    return res.send(
      new ServerResponse(true, { id: attachmentId }, "Attachment deleted"),
    );
  }
}
