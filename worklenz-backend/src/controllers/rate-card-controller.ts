import db from "../config/db";
import HandleExceptions from "../decorators/handle-exceptions";
import { IWorkLenzRequest } from "../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../interfaces/worklenz-response";
import { ServerResponse } from "../models/server-response";
import WorklenzControllerBase from "./worklenz-controller-base";

type RateCardRoleInput = {
  job_title_id?: string;
  jobId?: string;
  rate?: number | string;
  ratePerHour?: number | string;
  man_day_rate?: number | string;
};

function normalizeCurrency(value: unknown): string {
  const currency = String(value || "USD")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error("Currency must be a three-letter ISO code");
  return currency;
}

function normalizeRate(value: unknown): number {
  const rate = Number(value || 0);
  if (!Number.isFinite(rate) || rate < 0 || rate > 999999999999) {
    throw new Error("Rate must be a non-negative number");
  }
  return Math.round(rate * 100) / 100;
}

async function replaceRoles(
  client: import("pg").PoolClient,
  rateCardId: string,
  teamId: string,
  roles: RateCardRoleInput[],
): Promise<void> {
  await client.query(
    "DELETE FROM finance_rate_card_roles WHERE rate_card_id = $1::UUID",
    [rateCardId],
  );
  const seen = new Set<string>();
  for (const role of roles) {
    const jobTitleId = String(role.job_title_id || role.jobId || "");
    if (!jobTitleId || seen.has(jobTitleId)) continue;
    seen.add(jobTitleId);
    const result = await client.query(
      `INSERT INTO finance_rate_card_roles (rate_card_id, job_title_id, rate, man_day_rate)
       SELECT $1::UUID, jt.id, $3, $4
         FROM job_titles jt
        WHERE jt.id = $2::UUID AND jt.team_id = $5::UUID`,
      [
        rateCardId,
        jobTitleId,
        normalizeRate(role.rate ?? role.ratePerHour),
        normalizeRate(role.man_day_rate),
        teamId,
      ],
    );
    if (result.rowCount !== 1)
      throw new Error("A selected job title does not belong to this team");
  }
}

export default class RateCardController extends WorklenzControllerBase {
  @HandleExceptions()
  public static async get(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const page = Math.max(1, Number(req.query.index) || 1);
    const size = Math.min(100, Math.max(1, Number(req.query.size) || 20));
    const order = req.query.order === "asc" ? "ASC" : "DESC";
    const field = req.query.field === "name" ? "frc.name" : "frc.created_at";
    const search = String(req.query.search || "").trim();

    const result = await db.query(
      `SELECT frc.id, frc.name, LOWER(frc.currency) AS currency, frc.created_at,
              COUNT(*) OVER()::INT AS total
         FROM finance_rate_cards frc
        WHERE frc.team_id = $1::UUID
          AND ($2 = '' OR frc.name ILIKE '%' || $2 || '%')
        ORDER BY ${field} ${order}, frc.id
        LIMIT $3 OFFSET $4`,
      [req.user?.team_id, search, size, (page - 1) * size],
    );
    const total = result.rows[0]?.total || 0;
    const data = result.rows.map(({ total: _total, ...row }) => row);
    return res.status(200).send(new ServerResponse(true, { data, total }));
  }

  @HandleExceptions()
  public static async getById(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const result = await db.query(
      `SELECT frc.id, frc.name, LOWER(frc.currency) AS currency, frc.created_at,
              COALESCE(jsonb_agg(jsonb_build_object(
                'id', frcr.id,
                'rate_card_id', frc.id,
                'job_title_id', jt.id,
                'jobtitle', jt.name,
                'rate', frcr.rate,
                'man_day_rate', frcr.man_day_rate
              ) ORDER BY jt.name) FILTER (WHERE frcr.id IS NOT NULL), '[]'::JSONB) AS "jobRolesList"
         FROM finance_rate_cards frc
         LEFT JOIN finance_rate_card_roles frcr ON frcr.rate_card_id = frc.id
         LEFT JOIN job_titles jt ON jt.id = frcr.job_title_id
        WHERE frc.id = $1::UUID AND frc.team_id = $2::UUID
        GROUP BY frc.id`,
      [req.params.id, req.user?.team_id],
    );
    if (result.rowCount === 0)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Rate card not found"));
    return res.status(200).send(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
  public static async create(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const name = String(req.body.name || "Untitled Rate Card").trim();
    if (!name || name.length > 120)
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid rate card name"));
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO finance_rate_cards (team_id, name, currency)
         VALUES ($1::UUID, $2, $3)
         RETURNING id, name, LOWER(currency) AS currency, created_at`,
        [req.user?.team_id, name, normalizeCurrency(req.body.currency)],
      );
      await replaceRoles(
        client,
        result.rows[0].id,
        req.user?.team_id as string,
        req.body.jobRolesList || [],
      );
      await client.query("COMMIT");
      return res.status(201).send(new ServerResponse(true, result.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @HandleExceptions()
  public static async update(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 120)
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid rate card name"));
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE finance_rate_cards
            SET name = $1, currency = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3::UUID AND team_id = $4::UUID
          RETURNING id, name, LOWER(currency) AS currency, created_at`,
        [
          name,
          normalizeCurrency(req.body.currency),
          req.params.id,
          req.user?.team_id,
        ],
      );
      if (result.rowCount === 0) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .send(new ServerResponse(false, null, "Rate card not found"));
      }
      await replaceRoles(
        client,
        req.params.id,
        req.user?.team_id as string,
        req.body.jobRolesList || [],
      );
      const roles = await client.query(
        `SELECT frcr.id, frcr.rate_card_id, frcr.job_title_id, jt.name AS jobtitle,
                frcr.rate, frcr.man_day_rate
           FROM finance_rate_card_roles frcr
           JOIN job_titles jt ON jt.id = frcr.job_title_id
          WHERE frcr.rate_card_id = $1::UUID ORDER BY jt.name`,
        [req.params.id],
      );
      await client.query("COMMIT");
      return res.status(200).send(
        new ServerResponse(true, {
          ...result.rows[0],
          jobRolesList: roles.rows,
        }),
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @HandleExceptions()
  public static async delete(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const result = await db.query(
      "DELETE FROM finance_rate_cards WHERE id = $1::UUID AND team_id = $2::UUID RETURNING id",
      [req.params.id, req.user?.team_id],
    );
    if (result.rowCount === 0)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Rate card not found"));
    return res.status(200).send(new ServerResponse(true, null));
  }
}
