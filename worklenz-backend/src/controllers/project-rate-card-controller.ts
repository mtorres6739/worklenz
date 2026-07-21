import db from "../config/db";
import HandleExceptions from "../decorators/handle-exceptions";
import { IWorkLenzRequest } from "../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../interfaces/worklenz-response";
import { ServerResponse } from "../models/server-response";
import { canAccessProjectFinance } from "../shared/finance-permissions";
import WorklenzControllerBase from "./worklenz-controller-base";

type ProjectRateRoleInput = {
  job_title_id?: string;
  rate?: number | string;
  man_day_rate?: number | string;
};

function normalizeRate(value: unknown): number {
  const rate = Number(value || 0);
  if (!Number.isFinite(rate) || rate < 0 || rate > 999999999999) {
    throw new Error("Rate must be a non-negative number");
  }
  return Math.round(rate * 100) / 100;
}

async function replaceProjectRoles(
  client: import("pg").PoolClient,
  projectId: string,
  teamId: string,
  roles: ProjectRateRoleInput[],
) {
  await client.query(
    "UPDATE project_members SET project_rate_card_role_id = NULL WHERE project_id = $1::UUID",
    [projectId],
  );
  await client.query(
    "DELETE FROM project_rate_card_roles WHERE project_id = $1::UUID",
    [projectId],
  );

  const rows = [];
  const seen = new Set<string>();
  for (const role of roles) {
    const jobTitleId = String(role.job_title_id || "");
    if (!jobTitleId || seen.has(jobTitleId)) continue;
    seen.add(jobTitleId);
    const result = await client.query(
      `INSERT INTO project_rate_card_roles (project_id, job_title_id, rate, man_day_rate)
       SELECT $1::UUID, jt.id, $3, $4
         FROM job_titles jt
        WHERE jt.id = $2::UUID AND jt.team_id = $5::UUID
       RETURNING id, project_id, job_title_id, rate, man_day_rate`,
      [
        projectId,
        jobTitleId,
        normalizeRate(role.rate),
        normalizeRate(role.man_day_rate),
        teamId,
      ],
    );
    if (result.rowCount !== 1)
      throw new Error("A selected job title does not belong to this team");
    rows.push(result.rows[0]);
  }
  return rows;
}

async function authorize(
  req: IWorkLenzRequest,
  res: IWorkLenzResponse,
  projectId: string,
) {
  if (await canAccessProjectFinance(req.user, projectId)) return true;
  res
    .status(403)
    .send(
      new ServerResponse(
        false,
        null,
        "You are not authorized to manage project finance",
      ),
    );
  return false;
}

export default class ProjectRateCardController extends WorklenzControllerBase {
  @HandleExceptions()
  public static async insertMany(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const projectId = String(req.body.project_id || "");
    if (!(await authorize(req, res, projectId))) return res;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const rows = await replaceProjectRoles(
        client,
        projectId,
        req.user?.team_id as string,
        req.body.roles || [],
      );
      await client.query("COMMIT");
      return res.status(201).send(new ServerResponse(true, rows));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @HandleExceptions()
  public static async insertOne(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const projectId = String(req.body.project_id || "");
    if (!(await authorize(req, res, projectId))) return res;
    const result = await db.query(
      `INSERT INTO project_rate_card_roles (project_id, job_title_id, rate, man_day_rate)
       SELECT $1::UUID, jt.id, $3, $4
         FROM job_titles jt
        WHERE jt.id = $2::UUID AND jt.team_id = $5::UUID
       ON CONFLICT (project_id, job_title_id)
       DO UPDATE SET rate = EXCLUDED.rate,
                     man_day_rate = EXCLUDED.man_day_rate,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING id, project_id, job_title_id, rate, man_day_rate`,
      [
        projectId,
        req.body.job_title_id,
        normalizeRate(req.body.rate),
        normalizeRate(req.body.man_day_rate),
        req.user?.team_id,
      ],
    );
    if (result.rowCount !== 1)
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid job title"));
    return res.status(201).send(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
  public static async getFromProjectId(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    if (!(await authorize(req, res, req.params.projectId))) return res;
    const result = await db.query(
      `SELECT prcr.id, prcr.project_id, prcr.job_title_id, jt.name AS jobtitle,
              jt.name AS job_title_name, prcr.rate, prcr.man_day_rate,
              COALESCE((SELECT jsonb_agg(pm.id ORDER BY pm.id)
                          FROM project_members pm
                         WHERE pm.project_id = prcr.project_id
                           AND pm.project_rate_card_role_id = prcr.id), '[]'::JSONB) AS members
         FROM project_rate_card_roles prcr
         JOIN job_titles jt ON jt.id = prcr.job_title_id
        WHERE prcr.project_id = $1::UUID
        ORDER BY jt.name`,
      [req.params.projectId],
    );
    return res.status(200).send(new ServerResponse(true, result.rows));
  }

  @HandleExceptions()
  public static async getFromId(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const result = await db.query(
      `SELECT prcr.id, prcr.project_id, prcr.job_title_id, jt.name AS jobtitle,
              jt.name AS job_title_name, prcr.rate, prcr.man_day_rate,
              COALESCE((SELECT jsonb_agg(pm.id ORDER BY pm.id)
                          FROM project_members pm
                         WHERE pm.project_id = prcr.project_id
                           AND pm.project_rate_card_role_id = prcr.id), '[]'::JSONB) AS members
         FROM project_rate_card_roles prcr
         JOIN job_titles jt ON jt.id = prcr.job_title_id
         JOIN projects p ON p.id = prcr.project_id
        WHERE prcr.id = $1::UUID AND p.team_id = $2::UUID`,
      [req.params.id, req.user?.team_id],
    );
    if (result.rowCount === 0)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Rate-card role not found"));
    if (!(await authorize(req, res, result.rows[0].project_id))) return res;
    return res.status(200).send(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
  public static async updateFromId(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const current = await db.query(
      `SELECT prcr.project_id
         FROM project_rate_card_roles prcr
         JOIN projects p ON p.id = prcr.project_id
        WHERE prcr.id = $1::UUID AND p.team_id = $2::UUID`,
      [req.params.id, req.user?.team_id],
    );
    if (current.rowCount === 0)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Rate-card role not found"));
    if (!(await authorize(req, res, current.rows[0].project_id))) return res;
    const result = await db.query(
      `UPDATE project_rate_card_roles prcr
          SET job_title_id = jt.id,
              rate = COALESCE($3, prcr.rate),
              man_day_rate = COALESCE($4, prcr.man_day_rate),
              updated_at = CURRENT_TIMESTAMP
         FROM job_titles jt
        WHERE prcr.id = $1::UUID
          AND jt.id = $2::UUID
          AND jt.team_id = $5::UUID
       RETURNING prcr.id, prcr.project_id, prcr.job_title_id, prcr.rate, prcr.man_day_rate`,
      [
        req.params.id,
        req.body.job_title_id,
        req.body.rate === undefined ? null : normalizeRate(req.body.rate),
        req.body.man_day_rate === undefined
          ? null
          : normalizeRate(req.body.man_day_rate),
        req.user?.team_id,
      ],
    );
    if (result.rowCount === 0)
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid job title"));
    return res.status(200).send(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
  public static async updateProject(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    if (!(await authorize(req, res, req.params.projectId))) return res;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const rows = await replaceProjectRoles(
        client,
        req.params.projectId,
        req.user?.team_id as string,
        req.body.roles || [],
      );
      await client.query("COMMIT");
      return res.status(200).send(new ServerResponse(true, rows));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @HandleExceptions()
  public static async updateMemberRole(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    if (!(await authorize(req, res, req.params.projectId))) return res;
    const roleId = req.body.project_rate_card_role_id || null;
    const result = await db.query(
      `WITH updated AS (
         UPDATE project_members pm
            SET project_rate_card_role_id = CASE
                  WHEN pm.project_rate_card_role_id = $3::UUID THEN NULL
                  ELSE $3::UUID
                END
          WHERE pm.id = $2::UUID
            AND pm.project_id = $1::UUID
            AND EXISTS (
              SELECT 1 FROM project_rate_card_roles prcr
               WHERE prcr.id = $3::UUID AND prcr.project_id = $1::UUID
            )
         RETURNING pm.id, pm.project_id, pm.team_member_id, pm.project_rate_card_role_id
       )
       SELECT updated.*,
              COALESCE((SELECT jsonb_agg(pm.id ORDER BY pm.id)
                          FROM project_members pm
                         WHERE pm.project_id = $1::UUID
                           AND pm.project_rate_card_role_id = $3::UUID), '[]'::JSONB) AS members
         FROM updated`,
      [req.params.projectId, req.params.memberId, roleId],
    );
    if (result.rowCount === 0)
      return res
        .status(400)
        .send(
          new ServerResponse(false, null, "Invalid project member or role"),
        );
    return res.status(200).send(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
  public static async deleteFromId(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const current = await db.query(
      "SELECT project_id FROM project_rate_card_roles WHERE id = $1::UUID",
      [req.params.id],
    );
    if (current.rowCount === 0)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Rate-card role not found"));
    if (!(await authorize(req, res, current.rows[0].project_id))) return res;
    await db.query("DELETE FROM project_rate_card_roles WHERE id = $1::UUID", [
      req.params.id,
    ]);
    return res.status(200).send(new ServerResponse(true, current.rows[0]));
  }

  @HandleExceptions()
  public static async deleteFromProjectId(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    if (!(await authorize(req, res, req.params.projectId))) return res;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE project_members SET project_rate_card_role_id = NULL WHERE project_id = $1::UUID",
        [req.params.projectId],
      );
      const result = await client.query(
        "DELETE FROM project_rate_card_roles WHERE project_id = $1::UUID RETURNING id, project_id, job_title_id, rate, man_day_rate",
        [req.params.projectId],
      );
      await client.query("COMMIT");
      return res.status(200).send(new ServerResponse(true, result.rows));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
