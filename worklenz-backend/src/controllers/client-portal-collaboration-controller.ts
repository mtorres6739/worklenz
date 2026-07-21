import { Response } from "express";

import db from "../config/db";
import { ClientPortalRequest } from "../interfaces/client-portal-request";
import { ServerResponse } from "../models/server-response";
import { auditPortalEvent } from "../services/client-portal-session.service";
import { IO } from "../shared/io";
import {
  createPresignedViewUrl,
  getKey,
  getProjectFileStorageKey,
} from "../shared/storage";

interface ProjectGrant {
  project_id: string;
  team_id: string;
  client_id: string;
  access_level: "view" | "comment";
  can_view_files: boolean;
}

async function projectGrant(req: ClientPortalRequest, projectId: string): Promise<ProjectGrant | null> {
  const actor = req.portalActor;
  if (!actor) return null;
  const result = await db.query(
    `SELECT ppa.project_id, ppa.team_id, ppa.client_id, ppa.access_level, ppa.can_view_files
       FROM portal_project_access ppa
       JOIN projects p ON p.id = ppa.project_id AND p.team_id = ppa.team_id
      WHERE ppa.project_id = $1::UUID
        AND ppa.team_id = $2::UUID
        AND ppa.client_id = $3::UUID
        AND p.client_portal_visible = TRUE
      LIMIT 1`,
    [projectId, actor.teamId, actor.clientId],
  );
  return result.rows[0] || null;
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default class ClientPortalCollaborationController {
  public static async dashboard(req: ClientPortalRequest, res: Response): Promise<Response> {
    const actor = req.portalActor!;
    const result = await db.query(
      `SELECT COUNT(DISTINCT ppa.project_id)::INT AS total_projects,
              COUNT(DISTINCT ppa.project_id) FILTER (
                WHERE COALESCE(sps.name, '') NOT ILIKE '%complete%'
              )::INT AS active_projects,
              COUNT(DISTINCT t.id)::INT AS total_tasks,
              COUNT(DISTINCT t.id) FILTER (WHERE stc.is_done = TRUE)::INT AS completed_tasks,
              COUNT(DISTINCT ptc.id) FILTER (
                WHERE ptc.created_at > COALESCE(ptv.last_viewed_at, TIMESTAMPTZ 'epoch')
                  AND ptc.sender_type = 'staff'
              )::INT AS unread_comments
         FROM portal_project_access ppa
         JOIN projects p ON p.id = ppa.project_id AND p.team_id = ppa.team_id
         LEFT JOIN sys_project_statuses sps ON sps.id = p.status_id
         LEFT JOIN tasks t ON t.project_id = p.id AND t.archived = FALSE
         LEFT JOIN task_statuses ts ON ts.id = t.status_id
         LEFT JOIN sys_task_status_categories stc ON stc.id = ts.category_id
         LEFT JOIN portal_task_comments ptc ON ptc.task_id = t.id AND ptc.client_id = ppa.client_id
         LEFT JOIN portal_task_views ptv ON ptv.task_id = t.id AND ptv.membership_id = $3::UUID
        WHERE ppa.team_id = $1::UUID AND ppa.client_id = $2::UUID
          AND p.client_portal_visible = TRUE`,
      [actor.teamId, actor.clientId, actor.membershipId],
    );
    const stats = result.rows[0] || {};
    return res.send(new ServerResponse(true, {
      stats: {
        totalProjects: stats.total_projects || 0,
        activeProjects: stats.active_projects || 0,
        totalTasks: stats.total_tasks || 0,
        completedTasks: stats.completed_tasks || 0,
        unreadComments: stats.unread_comments || 0,
      },
    }));
  }

  public static async projects(req: ClientPortalRequest, res: Response): Promise<Response> {
    const actor = req.portalActor!;
    const result = await db.query(
      `SELECT p.id, p.name, p.key, p.notes AS description, p.start_date, p.end_date,
              p.updated_at, COALESCE(sps.name, 'Active') AS status,
              ppa.access_level, ppa.can_view_files,
              COUNT(DISTINCT t.id)::INT AS total_tasks,
              COUNT(DISTINCT t.id) FILTER (WHERE stc.is_done = TRUE)::INT AS completed_tasks,
              COALESCE(
                jsonb_agg(DISTINCT jsonb_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url))
                  FILTER (WHERE u.id IS NOT NULL), '[]'::JSONB
              ) AS members
         FROM portal_project_access ppa
         JOIN projects p ON p.id = ppa.project_id AND p.team_id = ppa.team_id
         LEFT JOIN sys_project_statuses sps ON sps.id = p.status_id
         LEFT JOIN tasks t ON t.project_id = p.id AND t.archived = FALSE
         LEFT JOIN task_statuses ts ON ts.id = t.status_id
         LEFT JOIN sys_task_status_categories stc ON stc.id = ts.category_id
         LEFT JOIN project_members pm ON pm.project_id = p.id
         LEFT JOIN team_members tm ON tm.id = pm.team_member_id
         LEFT JOIN users u ON u.id = tm.user_id AND u.is_deleted = FALSE
        WHERE ppa.team_id = $1::UUID AND ppa.client_id = $2::UUID
          AND p.client_portal_visible = TRUE
        GROUP BY p.id, sps.name, ppa.access_level, ppa.can_view_files
        ORDER BY p.updated_at DESC, p.name`,
      [actor.teamId, actor.clientId],
    );
    return res.send(new ServerResponse(true, { projects: result.rows, total: result.rowCount || 0 }));
  }

  public static async project(req: ClientPortalRequest, res: Response): Promise<Response> {
    const projectId = String(req.params.projectId || "");
    if (!validUuid(projectId)) return res.status(400).send(new ServerResponse(false, null, "Invalid project"));
    const grant = await projectGrant(req, projectId);
    if (!grant) return res.status(404).send(new ServerResponse(false, null, "Project not found"));
    const result = await db.query(
      `SELECT p.id, p.name, p.key, p.notes AS description, p.start_date, p.end_date, p.updated_at,
              COALESCE(sps.name, 'Active') AS status,
              $2::TEXT AS access_level, $3::BOOLEAN AS can_view_files,
              COUNT(DISTINCT t.id)::INT AS total_tasks,
              COUNT(DISTINCT t.id) FILTER (WHERE stc.is_done = TRUE)::INT AS completed_tasks,
              COALESCE(
                jsonb_agg(DISTINCT jsonb_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url))
                  FILTER (WHERE u.id IS NOT NULL), '[]'::JSONB
              ) AS members
         FROM projects p
         LEFT JOIN sys_project_statuses sps ON sps.id = p.status_id
         LEFT JOIN tasks t ON t.project_id = p.id AND t.archived = FALSE
         LEFT JOIN task_statuses ts ON ts.id = t.status_id
         LEFT JOIN sys_task_status_categories stc ON stc.id = ts.category_id
         LEFT JOIN project_members pm ON pm.project_id = p.id
         LEFT JOIN team_members tm ON tm.id = pm.team_member_id
         LEFT JOIN users u ON u.id = tm.user_id AND u.is_deleted = FALSE
        WHERE p.id = $1::UUID
        GROUP BY p.id, sps.name`,
      [projectId, grant.access_level, grant.can_view_files],
    );
    return res.send(new ServerResponse(true, result.rows[0]));
  }

  public static async tasks(req: ClientPortalRequest, res: Response): Promise<Response> {
    const projectId = String(req.params.projectId || "");
    if (!validUuid(projectId) || !(await projectGrant(req, projectId))) {
      return res.status(404).send(new ServerResponse(false, null, "Project not found"));
    }
    const result = await db.query(
      `SELECT t.id, t.name, t.description, t.done, t.task_no, t.start_date, t.end_date,
              t.parent_task_id, t.total_minutes, t.updated_at,
              ts.name AS status, stc.is_done, stc.color_code AS status_color,
              tp.name AS priority, tp.color_code AS priority_color,
              COALESCE(
                jsonb_agg(DISTINCT jsonb_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url))
                  FILTER (WHERE u.id IS NOT NULL), '[]'::JSONB
              ) AS assignees,
              COUNT(DISTINCT ptc.id)::INT AS portal_comment_count
         FROM tasks t
         JOIN task_statuses ts ON ts.id = t.status_id
         JOIN sys_task_status_categories stc ON stc.id = ts.category_id
         LEFT JOIN task_priorities tp ON tp.id = t.priority_id
         LEFT JOIN tasks_assignees ta ON ta.task_id = t.id
         LEFT JOIN team_members tm ON tm.id = ta.team_member_id
         LEFT JOIN users u ON u.id = tm.user_id AND u.is_deleted = FALSE
         LEFT JOIN portal_task_comments ptc ON ptc.task_id = t.id AND ptc.client_id = $2::UUID
        WHERE t.project_id = $1::UUID AND t.archived = FALSE
        GROUP BY t.id, ts.name, stc.is_done, stc.color_code, tp.name, tp.color_code
        ORDER BY t.parent_task_id NULLS FIRST, t.sort_order, t.task_no`,
      [projectId, req.portalActor!.clientId],
    );
    return res.send(new ServerResponse(true, { tasks: result.rows, total: result.rowCount || 0 }));
  }

  public static async task(req: ClientPortalRequest, res: Response): Promise<Response> {
    const projectId = String(req.params.projectId || "");
    const taskId = String(req.params.taskId || "");
    if (!validUuid(projectId) || !validUuid(taskId) || !(await projectGrant(req, projectId))) {
      return res.status(404).send(new ServerResponse(false, null, "Task not found"));
    }
    const result = await db.query(
      `SELECT t.id, t.name, t.description, t.done, t.task_no, t.start_date, t.end_date,
              t.parent_task_id, t.total_minutes, t.updated_at,
              ts.name AS status, stc.is_done, stc.color_code AS status_color,
              tp.name AS priority, tp.color_code AS priority_color
         FROM tasks t
         JOIN task_statuses ts ON ts.id = t.status_id
         JOIN sys_task_status_categories stc ON stc.id = ts.category_id
         LEFT JOIN task_priorities tp ON tp.id = t.priority_id
        WHERE t.id = $1::UUID AND t.project_id = $2::UUID AND t.archived = FALSE`,
      [taskId, projectId],
    );
    if (!result.rowCount) return res.status(404).send(new ServerResponse(false, null, "Task not found"));
    return res.send(new ServerResponse(true, result.rows[0]));
  }

  public static async comments(req: ClientPortalRequest, res: Response): Promise<Response> {
    const projectId = String(req.params.projectId || "");
    const taskId = String(req.params.taskId || "");
    if (!validUuid(projectId) || !validUuid(taskId) || !(await projectGrant(req, projectId))) {
      return res.status(404).send(new ServerResponse(false, null, "Task not found"));
    }
    const task = await db.query(`SELECT id FROM tasks WHERE id = $1::UUID AND project_id = $2::UUID AND archived = FALSE`, [taskId, projectId]);
    if (!task.rowCount) return res.status(404).send(new ServerResponse(false, null, "Task not found"));
    const result = await db.query(
      `SELECT id, sender_type, sender_name, comment, created_at, updated_at
         FROM portal_task_comments
        WHERE task_id = $1::UUID AND project_id = $2::UUID
          AND team_id = $3::UUID AND client_id = $4::UUID
        ORDER BY created_at, id`,
      [taskId, projectId, req.portalActor!.teamId, req.portalActor!.clientId],
    );
    await db.query(
      `INSERT INTO portal_task_views (membership_id, task_id, last_viewed_at)
       VALUES ($1::UUID, $2::UUID, CURRENT_TIMESTAMP)
       ON CONFLICT (membership_id, task_id)
       DO UPDATE SET last_viewed_at = CURRENT_TIMESTAMP`,
      [req.portalActor!.membershipId, taskId],
    );
    return res.send(new ServerResponse(true, { comments: result.rows, total: result.rowCount || 0 }));
  }

  public static async addComment(req: ClientPortalRequest, res: Response): Promise<Response> {
    const projectId = String(req.params.projectId || "");
    const taskId = String(req.params.taskId || "");
    const comment = String(req.body?.comment || "").trim();
    const grant = validUuid(projectId) && validUuid(taskId) ? await projectGrant(req, projectId) : null;
    if (!grant) return res.status(404).send(new ServerResponse(false, null, "Task not found"));
    if (grant.access_level !== "comment") return res.status(403).send(new ServerResponse(false, null, "This project is read-only"));
    if (!comment || comment.length > 5000) return res.status(400).send(new ServerResponse(false, null, "Comment must be between 1 and 5000 characters"));
    const task = await db.query(`SELECT id FROM tasks WHERE id = $1::UUID AND project_id = $2::UUID AND archived = FALSE`, [taskId, projectId]);
    if (!task.rowCount) return res.status(404).send(new ServerResponse(false, null, "Task not found"));
    const actor = req.portalActor!;
    const inserted = await db.query(
      `INSERT INTO portal_task_comments
         (team_id, client_id, project_id, task_id, membership_id, sender_type, sender_name, comment)
       VALUES ($1::UUID, $2::UUID, $3::UUID, $4::UUID, $5::UUID, 'client', $6, $7)
       RETURNING id, sender_type, sender_name, comment, created_at, updated_at`,
      [actor.teamId, actor.clientId, projectId, taskId, actor.membershipId, actor.name, comment],
    );
    const data = inserted.rows[0];
    IO.getInstance()?.to(`portal:project:${projectId}`).emit("portal:task-comment", { projectId, taskId, comment: data });
    IO.getInstance()?.to(projectId).emit("portal:task-comment", { projectId, taskId, comment: data });
    await auditPortalEvent({ action: "task.comment.created", actor, details: { projectId, taskId, commentId: data.id }, req });
    return res.status(201).send(new ServerResponse(true, data, "Comment added"));
  }

  public static async files(req: ClientPortalRequest, res: Response): Promise<Response> {
    const projectId = String(req.params.projectId || "");
    const grant = validUuid(projectId) ? await projectGrant(req, projectId) : null;
    if (!grant) return res.status(404).send(new ServerResponse(false, null, "Project not found"));
    if (!grant.can_view_files) return res.status(403).send(new ServerResponse(false, null, "File access is disabled"));
    const result = await db.query(
      `SELECT pf.id, pf.name, pf.size, pf.type, pf.created_at, 'project'::TEXT AS source, NULL::UUID AS task_id
         FROM project_files pf
        WHERE pf.project_id = $1::UUID AND pf.team_id = $2::UUID
       UNION ALL
       SELECT ta.id, ta.name, ta.size, ta.type, ta.created_at, 'task'::TEXT AS source, ta.task_id
         FROM task_attachments ta
        WHERE ta.project_id = $1::UUID AND ta.team_id = $2::UUID
       ORDER BY created_at DESC`,
      [projectId, req.portalActor!.teamId],
    );
    return res.send(new ServerResponse(true, { files: result.rows, total: result.rowCount || 0 }));
  }

  public static async downloadFile(req: ClientPortalRequest, res: Response): Promise<Response> {
    const projectId = String(req.params.projectId || "");
    const fileId = String(req.params.fileId || "");
    const source = req.query.source === "task" ? "task" : "project";
    const grant = validUuid(projectId) && validUuid(fileId) ? await projectGrant(req, projectId) : null;
    if (!grant || !grant.can_view_files) return res.status(404).send(new ServerResponse(false, null, "File not found"));
    const actor = req.portalActor!;
    const result = source === "task"
      ? await db.query(
        `SELECT id, name, type, team_id, project_id FROM task_attachments
          WHERE id = $1::UUID AND project_id = $2::UUID AND team_id = $3::UUID`,
        [fileId, projectId, actor.teamId],
      )
      : await db.query(
        `SELECT id, name, type, team_id, project_id FROM project_files
          WHERE id = $1::UUID AND project_id = $2::UUID AND team_id = $3::UUID`,
        [fileId, projectId, actor.teamId],
      );
    const file = result.rows[0];
    if (!file) return res.status(404).send(new ServerResponse(false, null, "File not found"));
    const key = source === "task"
      ? getKey(file.team_id, file.project_id, file.id, file.type)
      : getProjectFileStorageKey(file.team_id, file.project_id, file.id, file.type);
    const url = await createPresignedViewUrl(key, file.name, 900);
    await auditPortalEvent({ action: "file.download.authorized", actor, details: { projectId, fileId, source }, req });
    return res.send(new ServerResponse(true, { url, expires_in: 900 }));
  }
}
