import crypto from "crypto";
import { Response } from "express";

import db from "../config/db";
import { ClientPortalRequest } from "../interfaces/client-portal-request";
import { ServerResponse } from "../models/server-response";
import { auditPortalEvent } from "../services/client-portal-session.service";
import {
  createStaffRequestNotifications,
  emitRequestEvent,
} from "../services/client-portal-request-notifications.service";
import { scanPortalAttachment } from "../services/malware-scanner.service";
import {
  createPresignedViewUrl,
  deleteObject,
  getClientPortalStorageKey,
  uploadBuffer,
} from "../shared/storage";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pageOptions(req: ClientPortalRequest) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
}

function normalizedText(value: unknown, max: number): string | null {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function requestData(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(candidate, "attachments") ||
    Object.prototype.hasOwnProperty.call(candidate, "attachmentIds")
  ) {
    return null;
  }
  if (
    Array.isArray(candidate.questionAnswers) &&
    candidate.questionAnswers.some(
      (answer) =>
        answer &&
        typeof answer === "object" &&
        (Object.prototype.hasOwnProperty.call(answer, "attachments") ||
          Object.prototype.hasOwnProperty.call(answer, "attachmentIds")),
    )
  ) {
    return null;
  }
  if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > 64 * 1024) {
    return null;
  }
  return candidate;
}

function requiredFieldsSatisfied(
  definition: Record<string, unknown>,
  data: Record<string, unknown>,
): boolean {
  const fields = Array.isArray(definition.fields) ? definition.fields : [];
  const legacyFieldsSatisfied = fields.every((field) => {
    if (!field || typeof field !== "object") return true;
    const candidate = field as Record<string, unknown>;
    if (candidate.required !== true) return true;
    const key = String(candidate.key || "");
    if (!key || !Object.prototype.hasOwnProperty.call(data, key)) return false;
    const value = data[key];
    if (value === null || value === undefined) return false;
    return typeof value !== "string" || value.trim().length > 0;
  });
  if (!legacyFieldsSatisfied) return false;

  const requestForm = Array.isArray(definition.request_form)
    ? definition.request_form
    : [];
  const answers = Array.isArray(data.questionAnswers)
    ? data.questionAnswers
    : [];
  return requestForm.every((field) => {
    if (!field || typeof field !== "object") return true;
    const candidate = field as Record<string, unknown>;
    if (candidate.required !== true) return true;
    // Files are uploaded only after the request has a tenant-scoped ID. The
    // request details screen clearly prompts for the secure follow-up upload.
    if (candidate.type === "attachment") return true;
    const answer = answers.find(
      (item) =>
        item &&
        typeof item === "object" &&
        String((item as Record<string, unknown>).question || "") ===
          String(candidate.question || ""),
    ) as Record<string, unknown> | undefined;
    const value = answer?.answer;
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    return typeof value !== "string" || value.trim().length > 0;
  });
}

async function availableService(
  serviceId: string,
  teamId: string,
  clientId: string,
): Promise<Record<string, unknown> | null> {
  const result = await db.query(
    `SELECT ps.*
       FROM portal_services ps
      WHERE ps.id = $1::UUID
        AND ps.team_id = $2::UUID
        AND ps.status = 'active'
        AND (
          ps.is_public = TRUE
          OR EXISTS (
            SELECT 1
              FROM portal_service_clients psc
             WHERE psc.service_id = ps.id
               AND psc.team_id = ps.team_id
               AND psc.client_id = $3::UUID
          )
        )
      LIMIT 1`,
    [serviceId, teamId, clientId],
  );
  return result.rows[0] || null;
}

async function scopedRequest(
  requestId: string,
  teamId: string,
  clientId: string,
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
      WHERE pr.id = $1::UUID
        AND pr.team_id = $2::UUID
        AND pr.client_id = $3::UUID
      LIMIT 1`,
    [requestId, teamId, clientId],
  );
  return result.rows[0] || null;
}

export default class ClientPortalServicesRequestsController {
  public static async notifications(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const { limit, offset } = pageOptions(req);
    const result = await db.query(
      `SELECT pn.id, pn.request_id, pn.event_type, pn.title, pn.message,
              pn.event_data, pn.read_at, pn.created_at,
              pr.request_no AS req_no, COUNT(*) OVER()::INT AS full_count
         FROM portal_notifications pn
         JOIN portal_requests pr
           ON pr.id = pn.request_id
          AND pr.team_id = pn.team_id
          AND pr.client_id = pn.client_id
        WHERE pn.membership_id = $1::UUID
          AND pn.team_id = $2::UUID
          AND pn.client_id = $3::UUID
        ORDER BY pn.created_at DESC, pn.id
        LIMIT $4 OFFSET $5`,
      [
        actor.membershipId,
        actor.teamId,
        actor.clientId,
        limit,
        offset,
      ],
    );
    return res.send(
      new ServerResponse(true, {
        notifications: result.rows.map(
          ({ full_count: _fullCount, ...notification }) => notification,
        ),
        total: Number(result.rows[0]?.full_count || 0),
      }),
    );
  }

  public static async notificationUnreadCount(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const result = await db.query(
      `SELECT COUNT(*)::INT AS count
         FROM portal_notifications
        WHERE membership_id = $1::UUID
          AND team_id = $2::UUID
          AND client_id = $3::UUID
          AND read_at IS NULL`,
      [actor.membershipId, actor.teamId, actor.clientId],
    );
    return res.send(
      new ServerResponse(true, Number(result.rows[0]?.count || 0)),
    );
  }

  public static async markNotificationRead(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const id = String(req.params.id || "");
    if (!UUID_PATTERN.test(id)) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Notification not found"));
    }
    const result = await db.query(
      `UPDATE portal_notifications
          SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE id = $1::UUID
          AND membership_id = $2::UUID
          AND team_id = $3::UUID
          AND client_id = $4::UUID
        RETURNING id, read_at`,
      [id, actor.membershipId, actor.teamId, actor.clientId],
    );
    if (!result.rowCount) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Notification not found"));
    }
    return res.send(new ServerResponse(true, result.rows[0]));
  }

  public static async markAllNotificationsRead(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const result = await db.query(
      `UPDATE portal_notifications
          SET read_at = CURRENT_TIMESTAMP
        WHERE membership_id = $1::UUID
          AND team_id = $2::UUID
          AND client_id = $3::UUID
          AND read_at IS NULL`,
      [actor.membershipId, actor.teamId, actor.clientId],
    );
    return res.send(
      new ServerResponse(true, { updated: result.rowCount || 0 }),
    );
  }

  public static async services(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const result = await db.query(
      `SELECT ps.id, ps.name, ps.description, ps.service_key, ps.service_data,
              ps.price, ps.currency, ps.category, ps.updated_at
         FROM portal_services ps
        WHERE ps.team_id = $1::UUID
          AND ps.status = 'active'
          AND (
            ps.is_public = TRUE
            OR EXISTS (
              SELECT 1
                FROM portal_service_clients psc
               WHERE psc.service_id = ps.id
                 AND psc.team_id = ps.team_id
                 AND psc.client_id = $2::UUID
            )
          )
        ORDER BY ps.category NULLS LAST, ps.name`,
      [actor.teamId, actor.clientId],
    );
    return res.send(
      new ServerResponse(true, {
        services: result.rows,
        total: result.rowCount || 0,
      }),
    );
  }

  public static async service(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const id = String(req.params.id || "");
    if (!UUID_PATTERN.test(id)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid service"));
    }
    const service = await availableService(id, actor.teamId, actor.clientId);
    if (!service) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Service not found"));
    }
    return res.send(new ServerResponse(true, service));
  }

  public static async requests(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const { page, limit, offset } = pageOptions(req);
    const result = await db.query(
      `SELECT pr.*, pr.request_no AS req_no, ps.name AS service_name,
              ps.description AS service_description, c.name AS client_name,
              u.name AS assigned_to_name, COUNT(*) OVER()::INT AS full_count
         FROM portal_requests pr
         JOIN portal_services ps
           ON ps.id = pr.service_id AND ps.team_id = pr.team_id
         JOIN clients c ON c.id = pr.client_id AND c.team_id = pr.team_id
         LEFT JOIN users u ON u.id = pr.assigned_to
        WHERE pr.team_id = $1::UUID AND pr.client_id = $2::UUID
        ORDER BY pr.updated_at DESC, pr.request_number DESC
        LIMIT $3 OFFSET $4`,
      [actor.teamId, actor.clientId, limit, offset],
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

  public static async createRequest(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const serviceId = String(req.body?.service_id || "");
    const data = requestData(req.body?.request_data || req.body?.data);
    if (!UUID_PATTERN.test(serviceId) || !data) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid request"));
    }
    const service = await availableService(
      serviceId,
      actor.teamId,
      actor.clientId,
    );
    if (!service) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Service not found"));
    }
    if (
      !requiredFieldsSatisfied(
        (service.service_data || {}) as Record<string, unknown>,
        data,
      )
    ) {
      return res
        .status(400)
        .send(
          new ServerResponse(
            false,
            null,
            "Required request fields are missing",
          ),
        );
    }

    const client = await db.connect();
    let createdRequest: Record<string, unknown> | undefined;
    let staffUserIds: string[] = [];
    let requestEvent:
      | Parameters<typeof emitRequestEvent>[0]
      | undefined;
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO portal_requests
           (request_no, team_id, client_id, service_id,
            submitted_by_membership_id, request_data, notes)
         VALUES ($1, $2::UUID, $3::UUID, $4::UUID, $5::UUID, $6::JSONB, $7)
         RETURNING *`,
        [
          crypto.randomUUID(),
          actor.teamId,
          actor.clientId,
          serviceId,
          actor.membershipId,
          JSON.stringify(data),
          normalizedText(req.body?.notes, 10000),
        ],
      );
      const requestNo = `${String(service.service_key)}-${String(
        inserted.rows[0].request_number,
      ).padStart(6, "0")}`;
      const updated = await client.query(
        `UPDATE portal_requests
            SET request_no = $2
          WHERE id = $1::UUID
          RETURNING *`,
        [inserted.rows[0].id, requestNo],
      );
      createdRequest = {
        ...updated.rows[0],
        req_no: updated.rows[0].request_no,
        service_name: service.name,
      };
      await client.query(
        `INSERT INTO portal_request_status_history
           (request_id, team_id, client_id, to_status,
            changed_by_membership_id)
         VALUES ($1::UUID, $2::UUID, $3::UUID, 'pending', $4::UUID)`,
        [inserted.rows[0].id, actor.teamId, actor.clientId, actor.membershipId],
      );
      requestEvent = {
        requestId: inserted.rows[0].id,
        requestNo,
        teamId: actor.teamId,
        clientId: actor.clientId,
        eventType: "request_created",
        title: "New service request",
        message: `${actor.name} submitted request ${requestNo}.`,
        data: { serviceName: String(service.name) },
      };
      staffUserIds = await createStaffRequestNotifications(client, {
        ...requestEvent,
        assignedUserId: null,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await auditPortalEvent({
      action: "request.created",
      actor,
      details: { requestId: requestEvent!.requestId, serviceId },
      req,
    });
    emitRequestEvent(requestEvent!, staffUserIds);
    return res
      .status(201)
      .send(new ServerResponse(true, createdRequest, "Request submitted"));
  }

  public static async request(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const id = String(req.params.id || "");
    if (!UUID_PATTERN.test(id)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid request"));
    }
    const request = await scopedRequest(id, actor.teamId, actor.clientId);
    if (!request) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Request not found"));
    }
    return res.send(new ServerResponse(true, request));
  }

  public static async comments(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const id = String(req.params.id || "");
    if (
      !UUID_PATTERN.test(id) ||
      !(await scopedRequest(id, actor.teamId, actor.clientId))
    ) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Request not found"));
    }
    const result = await db.query(
      `SELECT id, comment, sender_type, sender_name, created_at, updated_at
         FROM portal_request_comments
        WHERE request_id = $1::UUID
          AND team_id = $2::UUID
          AND client_id = $3::UUID
        ORDER BY created_at, id`,
      [id, actor.teamId, actor.clientId],
    );
    return res.send(
      new ServerResponse(true, {
        comments: result.rows,
        total: result.rowCount || 0,
      }),
    );
  }

  public static async addComment(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const id = String(req.params.id || "");
    const comment = normalizedText(req.body?.comment, 5000);
    if (!UUID_PATTERN.test(id) || !comment) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "A valid comment is required"));
    }
    const request = await scopedRequest(id, actor.teamId, actor.clientId);
    if (!request) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Request not found"));
    }
    const client = await db.connect();
    let createdComment: Record<string, unknown> | undefined;
    let staffUserIds: string[] = [];
    const requestNo = String(request.request_no);
    const requestEvent: Parameters<typeof emitRequestEvent>[0] = {
      requestId: id,
      requestNo,
      teamId: actor.teamId,
      clientId: actor.clientId,
      eventType: "request_comment_added",
      title: "New client comment",
      message: `${actor.name} commented on request ${requestNo}.`,
    };
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO portal_request_comments
           (request_id, team_id, client_id, membership_id, sender_type,
            sender_name, comment)
         VALUES ($1::UUID, $2::UUID, $3::UUID, $4::UUID, 'client', $5, $6)
         RETURNING id, comment, sender_type, sender_name, created_at, updated_at`,
        [
          id,
          actor.teamId,
          actor.clientId,
          actor.membershipId,
          actor.name,
          comment,
        ],
      );
      createdComment = result.rows[0];
      await client.query(
        `UPDATE portal_requests
            SET updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::UUID
            AND team_id = $2::UUID
            AND client_id = $3::UUID`,
        [id, actor.teamId, actor.clientId],
      );
      staffUserIds = await createStaffRequestNotifications(client, {
        ...requestEvent,
        assignedUserId: request.assigned_to
          ? String(request.assigned_to)
          : null,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await auditPortalEvent({
      action: "request.comment.created",
      actor,
      details: { requestId: id, commentId: createdComment!.id },
      req,
    });
    emitRequestEvent(requestEvent, staffUserIds);
    return res
      .status(201)
      .send(new ServerResponse(true, createdComment, "Comment added"));
  }

  public static async attachments(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const id = String(req.params.id || "");
    if (
      !UUID_PATTERN.test(id) ||
      !(await scopedRequest(id, actor.teamId, actor.clientId))
    ) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Request not found"));
    }
    const result = await db.query(
      `SELECT id, file_name AS name, mime_type, size, sender_type, created_at,
              (membership_id = $4::UUID) AS can_delete
         FROM portal_request_attachments
        WHERE request_id = $1::UUID
          AND team_id = $2::UUID
          AND client_id = $3::UUID
        ORDER BY created_at, id`,
      [id, actor.teamId, actor.clientId, actor.membershipId],
    );
    return res.send(
      new ServerResponse(true, {
        attachments: result.rows,
        total: result.rowCount || 0,
      }),
    );
  }

  public static async uploadAttachment(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const requestId = String(req.params.id || "");
    const file = req.file;
    const meta = req.portalRequestFileMeta;
    if (!UUID_PATTERN.test(requestId) || !file || !meta) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid attachment"));
    }
    const request = await scopedRequest(
      requestId,
      actor.teamId,
      actor.clientId,
    );
    if (!request) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Request not found"));
    }

    const scan = await scanPortalAttachment(file.buffer);
    if (scan.status === "infected") {
      await auditPortalEvent({
        action: "request.attachment.blocked",
        actor,
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
    const objectKey = getClientPortalStorageKey(
      "request-attachments",
      actor.teamId,
      actor.clientId,
      requestId,
      `${attachmentId}.${meta.extension}`,
    );
    const uploaded = await uploadBuffer(file.buffer, meta.mimeType, objectKey);
    if (!uploaded) {
      return res
        .status(500)
        .send(new ServerResponse(false, null, "Attachment upload failed"));
    }

    const client = await db.connect();
    let attachment: Record<string, unknown> | undefined;
    let staffUserIds: string[] = [];
    const requestNo = String(request.request_no);
    const requestEvent: Parameters<typeof emitRequestEvent>[0] = {
      requestId,
      requestNo,
      teamId: actor.teamId,
      clientId: actor.clientId,
      eventType: "request_attachment_added",
      title: "New client attachment",
      message: `${actor.name} added an attachment to request ${requestNo}.`,
    };
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO portal_request_attachments
           (id, request_id, team_id, client_id, membership_id, sender_type,
            object_key, file_name, mime_type, size)
         VALUES ($1::UUID, $2::UUID, $3::UUID, $4::UUID, $5::UUID, 'client',
                 $6, $7, $8, $9)
         RETURNING id, file_name AS name, mime_type, size, sender_type, created_at`,
        [
          attachmentId,
          requestId,
          actor.teamId,
          actor.clientId,
          actor.membershipId,
          objectKey,
          meta.cleanFileName,
          meta.mimeType,
          file.size,
        ],
      );
      attachment = inserted.rows[0];
      await client.query(
        `UPDATE portal_requests
            SET updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::UUID
            AND team_id = $2::UUID
            AND client_id = $3::UUID`,
        [requestId, actor.teamId, actor.clientId],
      );
      staffUserIds = await createStaffRequestNotifications(client, {
        ...requestEvent,
        assignedUserId: request.assigned_to
          ? String(request.assigned_to)
          : null,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      await deleteObject(objectKey);
      throw error;
    } finally {
      client.release();
    }
    await auditPortalEvent({
      action: "request.attachment.uploaded",
      actor,
      details: { requestId, attachmentId },
      req,
    });
    emitRequestEvent(requestEvent, staffUserIds);
    return res
      .status(201)
      .send(new ServerResponse(true, attachment, "Attachment uploaded"));
  }

  public static async downloadAttachment(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const requestId = String(req.params.id || "");
    const attachmentId = String(req.params.attachmentId || "");
    if (!UUID_PATTERN.test(requestId) || !UUID_PATTERN.test(attachmentId)) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Attachment not found"));
    }
    const result = await db.query(
      `SELECT pra.id, pra.file_name, pra.object_key
         FROM portal_request_attachments pra
         JOIN portal_requests pr
           ON pr.id = pra.request_id
          AND pr.team_id = pra.team_id
          AND pr.client_id = pra.client_id
        WHERE pra.id = $1::UUID
          AND pra.request_id = $2::UUID
          AND pra.team_id = $3::UUID
          AND pra.client_id = $4::UUID
        LIMIT 1`,
      [attachmentId, requestId, actor.teamId, actor.clientId],
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
      actor,
      details: { requestId, attachmentId },
      req,
    });
    return res.send(new ServerResponse(true, { url, expires_in: 300 }));
  }

  public static async deleteAttachment(
    req: ClientPortalRequest,
    res: Response,
  ): Promise<Response> {
    const actor = req.portalActor!;
    const requestId = String(req.params.id || "");
    const attachmentId = String(req.params.attachmentId || "");
    if (!UUID_PATTERN.test(requestId) || !UUID_PATTERN.test(attachmentId)) {
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Attachment not found"));
    }
    const attachment = await db.query(
      `SELECT object_key
         FROM portal_request_attachments
        WHERE id = $1::UUID
          AND request_id = $2::UUID
          AND team_id = $3::UUID
          AND client_id = $4::UUID
          AND membership_id = $5::UUID`,
      [
        attachmentId,
        requestId,
        actor.teamId,
        actor.clientId,
        actor.membershipId,
      ],
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
          AND client_id = $4::UUID
          AND membership_id = $5::UUID
        RETURNING id`,
      [
        attachmentId,
        requestId,
        actor.teamId,
        actor.clientId,
        actor.membershipId,
      ],
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
      actor,
      details: { requestId, attachmentId },
      req,
    });
    return res.send(
      new ServerResponse(true, { id: attachmentId }, "Attachment deleted"),
    );
  }
}
