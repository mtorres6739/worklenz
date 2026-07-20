import {PoolClient} from "pg";

import {IWorkLenzRequest} from "../interfaces/worklenz-request";
import {IWorkLenzResponse} from "../interfaces/worklenz-response";
import db from "../config/db";
import {ServerResponse} from "../models/server-response";
import WorklenzControllerBase from "./worklenz-controller-base";
import HandleExceptions from "../decorators/handle-exceptions";
import {
  buildTemplateTree,
  flattenTemplateTasks,
  ITaskTemplateLabel,
  ITaskTemplateTaskRow,
} from "./task-template-utils";

interface ITemplateStatusConfiguration {
  name: string;
  category: "todo" | "doing" | "done";
}

interface ITemplateConfiguration {
  phase?: {name?: string; color_code?: string};
  statuses?: ITemplateStatusConfiguration[];
  default_status?: string;
}

const DEFAULT_PHASE_COLOR = "#1677ff";
const DEFAULT_LABEL_COLOR = "#1677ff";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEMPLATE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function toConfiguration(value: unknown): ITemplateConfiguration {
  return value && typeof value === "object" ? value as ITemplateConfiguration : {};
}

async function insertTemplateRows(
  client: PoolClient,
  templateId: string,
  rows: ITaskTemplateTaskRow[],
) {
  for (const row of rows) {
    await client.query(`
      INSERT INTO task_templates_tasks (
        template_id, item_key, parent_item_key, parent_task_name, name,
        description, total_minutes, labels, due_offset_days, depends_on_keys, sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::JSONB, $9, $10::TEXT[], $11)
    `, [
      templateId,
      row.item_key,
      row.parent_item_key,
      null,
      row.name,
      row.description,
      row.total_minutes,
      JSON.stringify(row.labels),
      row.due_offset_days,
      row.depends_on_keys,
      row.sort_order,
    ]);
  }
}

async function ensureProjectStatus(
  client: PoolClient,
  projectId: string,
  teamId: string,
  status: ITemplateStatusConfiguration,
): Promise<string> {
  const category = await client.query(`
    SELECT id
    FROM sys_task_status_categories
    WHERE ($1 = 'todo' AND is_todo IS TRUE)
       OR ($1 = 'doing' AND is_doing IS TRUE)
       OR ($1 = 'done' AND is_done IS TRUE)
    LIMIT 1
  `, [status.category]);
  if (!category.rows[0]?.id) throw new Error(`Missing ${status.category} task status category.`);

  const existing = await client.query(
    `SELECT id, category_id
     FROM task_statuses
     WHERE project_id = $1 AND LOWER(name) = LOWER($2)
     LIMIT 1`,
    [projectId, status.name],
  );
  if (existing.rows[0]?.id) {
    if (existing.rows[0].category_id !== category.rows[0].id) {
      await client.query(
        `UPDATE task_statuses SET category_id = $1 WHERE id = $2`,
        [category.rows[0].id, existing.rows[0].id],
      );
    }
    return existing.rows[0].id;
  }

  const result = await client.query(`
    INSERT INTO task_statuses (name, project_id, team_id, category_id, sort_order)
    VALUES (
      $1, $2, $3, $4,
      COALESCE((SELECT MAX(sort_order) + 1 FROM task_statuses WHERE project_id = $2), 0)
    )
    RETURNING id
  `, [status.name.slice(0, 50), projectId, teamId, category.rows[0].id]);
  return result.rows[0].id;
}

async function ensureTeamLabel(
  client: PoolClient,
  teamId: string,
  label: ITaskTemplateLabel,
): Promise<string> {
  const existing = await client.query(
    `SELECT id FROM team_labels WHERE team_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [teamId, label.name],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const result = await client.query(`
    INSERT INTO team_labels (name, color_code, team_id)
    VALUES ($1, $2, $3)
    RETURNING id
  `, [label.name.slice(0, 40), label.color_code || DEFAULT_LABEL_COLOR, teamId]);
  return result.rows[0].id;
}

export default class TasktemplatesController extends WorklenzControllerBase {
  @HandleExceptions()
  public static async create(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const teamId = req.user?.team_id;
    const name = String(req.body.name || "").trim();
    const templateKey = req.body.template_key === undefined || req.body.template_key === null
      ? null
      : String(req.body.template_key).trim().toLowerCase();
    const requestedVersion = Number(req.body.version ?? 1);
    if (!teamId || !name || !Array.isArray(req.body.tasks)) {
      return res.status(400).send(new ServerResponse(false, null, "Template name and tasks are required."));
    }
    if (templateKey && !TEMPLATE_KEY_PATTERN.test(templateKey)) {
      return res.status(400).send(new ServerResponse(false, null, "Template key must contain lowercase letters, numbers, and single hyphens."));
    }
    if (!Number.isInteger(requestedVersion) || requestedVersion < 1) {
      return res.status(400).send(new ServerResponse(false, null, "Template version must be a positive integer."));
    }

    let rows: ITaskTemplateTaskRow[];
    try {
      rows = flattenTemplateTasks(req.body.tasks);
    } catch (error: any) {
      return res.status(400).send(new ServerResponse(false, null, error.message));
    }

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const duplicate = await client.query(
        `SELECT 1
         FROM task_templates
         WHERE team_id = $1
           AND (LOWER(name) = LOWER($2) OR ($3::TEXT IS NOT NULL AND template_key = $3))`,
        [teamId, name, templateKey],
      );
      if (duplicate.rowCount) {
        await client.query("ROLLBACK");
        return res.status(200).send(new ServerResponse(false, null, `A template with the name "${name}" already exists. Please choose a different name.`));
      }

      const created = await client.query(`
        INSERT INTO task_templates (
          name, team_id, template_key, version, description, configuration
        ) VALUES ($1, $2, $3, $4, $5, $6::JSONB)
        RETURNING id, name, template_key, version
      `, [
        name,
        teamId,
        templateKey,
        requestedVersion,
        req.body.description || null,
        JSON.stringify(req.body.configuration || {}),
      ]);
      await insertTemplateRows(client, created.rows[0].id, rows);
      await client.query("COMMIT");
      return res.status(200).send(new ServerResponse(true, created.rows[0], "Task template created successfully"));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @HandleExceptions()
  public static async get(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const result = await db.query(`
      SELECT id, name, template_key, version, description, configuration, created_at, updated_at
      FROM task_templates
      WHERE team_id = $1
      ORDER BY name
    `, [req.user?.team_id]);
    return res.status(200).send(new ServerResponse(true, result.rows));
  }

  @HandleExceptions()
  public static async getById(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const template = await db.query(`
      SELECT id, name, template_key, version, description, configuration
      FROM task_templates
      WHERE id = $1 AND team_id = $2
    `, [req.params.id, req.user?.team_id]);
    if (!template.rows.length) {
      return res.status(404).send(new ServerResponse(false, null, "Template not found"));
    }

    const tasks = await db.query(`
      SELECT id, item_key, parent_item_key, parent_task_name, name, description,
             total_minutes, labels, due_offset_days, depends_on_keys, sort_order
      FROM task_templates_tasks
      WHERE template_id = $1
      ORDER BY sort_order, id
    `, [req.params.id]);

    const rows = tasks.rows.map(row => ({
      ...row,
      total_minutes: Number(row.total_minutes) || 0,
      labels: Array.isArray(row.labels) ? row.labels : [],
      depends_on_keys: Array.isArray(row.depends_on_keys) ? row.depends_on_keys : [],
    })) as ITaskTemplateTaskRow[];

    return res.status(200).send(new ServerResponse(true, {
      ...template.rows[0],
      tasks: buildTemplateTree(rows),
    }));
  }

  @HandleExceptions()
  public static async update(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const teamId = req.user?.team_id;
    const name = String(req.body.name || "").trim();
    if (!teamId || !name || !Array.isArray(req.body.tasks)) {
      return res.status(400).send(new ServerResponse(false, null, "Template name and tasks are required."));
    }

    let rows: ITaskTemplateTaskRow[];
    try {
      rows = flattenTemplateTasks(req.body.tasks);
    } catch (error: any) {
      return res.status(400).send(new ServerResponse(false, null, error.message));
    }

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT id FROM task_templates WHERE id = $1 AND team_id = $2 FOR UPDATE`,
        [req.params.id, teamId],
      );
      if (!existing.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).send(new ServerResponse(false, null, "Template not found"));
      }

      const installed = await client.query(
        `SELECT 1 FROM task_template_imports WHERE template_id = $1 LIMIT 1`,
        [req.params.id],
      );
      if (installed.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).send(new ServerResponse(
          false,
          null,
          "Installed template versions are immutable. Create a new template version instead.",
        ));
      }

      const duplicate = await client.query(`
        SELECT 1 FROM task_templates
        WHERE team_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3
      `, [teamId, name, req.params.id]);
      if (duplicate.rowCount) {
        await client.query("ROLLBACK");
        return res.status(200).send(new ServerResponse(false, null, `A template with the name "${name}" already exists. Please choose a different name.`));
      }

      await client.query(`
        UPDATE task_templates
        SET name = $1,
            description = COALESCE($2, description),
            configuration = COALESCE($3::JSONB, configuration),
            version = version + 1,
            updated_at = NOW()
        WHERE id = $4 AND team_id = $5
      `, [
        name,
        req.body.description ?? null,
        req.body.configuration === undefined ? null : JSON.stringify(req.body.configuration),
        req.params.id,
        teamId,
      ]);
      await client.query(`DELETE FROM task_templates_tasks WHERE template_id = $1`, [req.params.id]);
      await insertTemplateRows(client, req.params.id, rows);
      await client.query("COMMIT");
      return res.status(200).send(new ServerResponse(true, {id: req.params.id}, "Template updated."));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @HandleExceptions()
  public static async deleteById(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const result = await db.query(
      `DELETE FROM task_templates template
       WHERE template.id = $1
         AND template.team_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM task_template_imports imported WHERE imported.template_id = template.id
         )
       RETURNING template.id`,
      [req.params.id, req.user?.team_id],
    );
    if (!result.rowCount) {
      const existing = await db.query(
        `SELECT EXISTS(
           SELECT 1 FROM task_templates WHERE id = $1 AND team_id = $2
         ) AS template_exists`,
        [req.params.id, req.user?.team_id],
      );
      if (existing.rows[0]?.template_exists) {
        return res.status(409).send(new ServerResponse(
          false,
          null,
          "Installed template versions are immutable and cannot be deleted.",
        ));
      }
      return res.status(404).send(new ServerResponse(false, null, "Template not found"));
    }
    return res.status(200).send(new ServerResponse(true, result.rows, "Template deleted."));
  }

  /** Backward-compatible import path used by older clients. */
  @HandleExceptions()
  public static async import(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const result = await db.query(`SELECT import_tasks_from_template($1, $2, $3);`, [
      req.params.id,
      req.user?.id,
      JSON.stringify(req.body),
    ]);
    return res.status(200).send(new ServerResponse(true, result.rows[0], "Tasks imported successfully!"));
  }

  @HandleExceptions()
  public static async importToProject(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const projectId = req.params.projectId;
    const templateId = String(req.body.template_id || "");
    const launchTarget = String(req.body.launch_target || "");
    const defaultAssigneeId = String(req.body.default_assignee_id || "");
    const requestedPhase = String(req.body.destination_phase || "").trim();
    const userId = req.user?.id;
    const activeTeamId = req.user?.team_id;

    if (
      !projectId ||
      !UUID_PATTERN.test(projectId) ||
      !UUID_PATTERN.test(templateId) ||
      !UUID_PATTERN.test(defaultAssigneeId) ||
      !isIsoDate(launchTarget)
    ) {
      return res.status(400).send(new ServerResponse(false, null, "Template, launch target, and default assignee are required."));
    }
    if (!userId || !activeTeamId) {
      return res.status(401).send(new ServerResponse(false, null, "Authentication required."));
    }

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${projectId}:${templateId}`]);

      const project = await client.query(`SELECT id, team_id FROM projects WHERE id = $1 FOR UPDATE`, [projectId]);
      if (!project.rows[0] || project.rows[0].team_id !== activeTeamId) {
        await client.query("ROLLBACK");
        return res.status(404).send(new ServerResponse(false, null, "Project not found."));
      }

      const template = await client.query(`
        SELECT id, team_id, version, configuration
        FROM task_templates
        WHERE id = $1 AND team_id = $2
      `, [templateId, activeTeamId]);
      if (!template.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).send(new ServerResponse(false, null, "Template not found."));
      }

      const previousImport = await client.query(`
        SELECT id, created_at FROM task_template_imports
        WHERE project_id = $1 AND template_id = $2
      `, [projectId, templateId]);
      if (previousImport.rows[0]) {
        await client.query("COMMIT");
        return res.status(200).send(new ServerResponse(true, {
          import_id: previousImport.rows[0].id,
          already_imported: true,
          created_count: 0,
        }, "This checklist is already installed in the project."));
      }

      const assignee = await client.query(
        `SELECT id
         FROM team_members
         WHERE id = $1 AND team_id = $2 AND user_id IS NOT NULL AND active IS TRUE`,
        [defaultAssigneeId, activeTeamId],
      );
      if (!assignee.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(400).send(new ServerResponse(false, null, "Default assignee is not an active workspace member."));
      }

      const configuration = toConfiguration(template.rows[0].configuration);
      const phaseName = (requestedPhase || configuration.phase?.name || "Pre-Launch QA").slice(0, 100);
      const requestedPhaseColor = String(configuration.phase?.color_code || "");
      const phaseColor = HEX_COLOR_PATTERN.test(requestedPhaseColor)
        ? requestedPhaseColor
        : DEFAULT_PHASE_COLOR;
      let phase = await client.query(
        `SELECT id FROM project_phases WHERE project_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
        [projectId, phaseName],
      );
      if (!phase.rows[0]) {
        phase = await client.query(`
          INSERT INTO project_phases (name, color_code, project_id, sort_index)
          VALUES ($1, $2, $3, COALESCE((SELECT MAX(sort_index) + 1 FROM project_phases WHERE project_id = $3), 0))
          RETURNING id
        `, [phaseName, phaseColor, projectId]);
      }
      const phaseId = phase.rows[0].id;

      const configuredStatuses = Array.isArray(configuration.statuses) ? configuration.statuses : [];
      for (const status of configuredStatuses) {
        if (status?.name && ["todo", "doing", "done"].includes(status.category)) {
          await ensureProjectStatus(client, projectId, activeTeamId, status);
        }
      }

      const defaultStatusName = configuration.default_status || "To Do";
      let defaultStatus = await client.query(`
        SELECT id FROM task_statuses
        WHERE project_id = $1 AND LOWER(name) = LOWER($2)
        LIMIT 1
      `, [projectId, defaultStatusName]);
      if (!defaultStatus.rows[0]) {
        const id = await ensureProjectStatus(client, projectId, activeTeamId, {
          name: defaultStatusName,
          category: "todo",
        });
        defaultStatus = {rows: [{id}]} as any;
      }

      const priority = await client.query(`SELECT id FROM task_priorities WHERE value = 1 LIMIT 1`);
      if (!priority.rows[0]?.id) throw new Error("Default task priority is missing.");

      const templateTasks = await client.query(`
        SELECT id, item_key, parent_item_key, parent_task_name, name, description,
               total_minutes, labels, due_offset_days, depends_on_keys, sort_order
        FROM task_templates_tasks
        WHERE template_id = $1
        ORDER BY sort_order, id
      `, [templateId]);
      if (!templateTasks.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).send(new ServerResponse(false, null, "Template has no tasks."));
      }

      const rows = templateTasks.rows as Array<ITaskTemplateTaskRow & {id: string}>;
      const nameToKey = new Map<string, string>();
      for (const row of rows) if (!nameToKey.has(row.name)) nameToKey.set(row.name, row.item_key);
      for (const row of rows) {
        if (!row.parent_item_key && row.parent_task_name) {
          row.parent_item_key = nameToKey.get(row.parent_task_name) || null;
        }
      }

      const imported = await client.query(`
        INSERT INTO task_template_imports (
          project_id, template_id, template_version, destination_phase_id,
          launch_target, default_assignee_id, imported_by
        ) VALUES ($1, $2, $3, $4, $5::DATE, $6, $7)
        RETURNING id
      `, [projectId, templateId, template.rows[0].version, phaseId, launchTarget, defaultAssigneeId, userId]);
      const importId = imported.rows[0].id;

      const maxSort = await client.query(
        `SELECT COALESCE(MAX(sort_order), 0) AS value FROM tasks WHERE project_id = $1`,
        [projectId],
      );
      let nextSort = Number(maxSort.rows[0].value) || 0;
      const taskIds = new Map<string, string>();
      for (const row of rows) {
        const parentId = row.parent_item_key ? taskIds.get(row.parent_item_key) : null;
        if (row.parent_item_key && !parentId) {
          throw new Error(`Template parent ${row.parent_item_key} is unresolved.`);
        }

        nextSort += 1;
        const created = await client.query(`
            INSERT INTO tasks (
              name, description, total_minutes, priority_id, project_id, reporter_id,
              parent_task_id, status_id, end_date, sort_order, roadmap_sort_order,
              status_sort_order, priority_sort_order, phase_sort_order, member_sort_order
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8,
              CASE WHEN $9::INTEGER IS NULL THEN NULL ELSE $10::DATE - $9::INTEGER END,
              $11, $11, $11, $11, $11, $11
            )
            RETURNING id
          `, [
            row.name,
            row.description,
            Number(row.total_minutes) || 0,
            priority.rows[0].id,
            projectId,
            userId,
            parentId || null,
            defaultStatus.rows[0].id,
            row.due_offset_days,
            launchTarget,
            nextSort,
          ]);
        const taskId = created.rows[0].id;
        taskIds.set(row.item_key, taskId);

        await client.query(`INSERT INTO task_phase (task_id, phase_id) VALUES ($1, $2)`, [taskId, phaseId]);
        for (const label of Array.isArray(row.labels) ? row.labels : []) {
          const labelId = await ensureTeamLabel(client, activeTeamId, label);
          await client.query(`
              INSERT INTO task_labels (task_id, label_id)
              VALUES ($1, $2)
              ON CONFLICT DO NOTHING
            `, [taskId, labelId]);
        }
        await client.query(`SELECT create_task_assignee($1, $2, $3, $4)`, [
          defaultAssigneeId,
          projectId,
          taskId,
          userId,
        ]);
        await client.query(`
            INSERT INTO task_activity_logs (
              task_id, team_id, attribute_type, user_id, log_type,
              old_value, new_value, project_id
            ) VALUES ($1, $2, 'status', $3, 'update', NULL, $4, $5)
          `, [taskId, activeTeamId, userId, defaultStatus.rows[0].id, projectId]);
        await client.query(`
            INSERT INTO task_template_import_items (
              import_id, template_task_id, task_id, item_key
            ) VALUES ($1, $2, $3, $4)
          `, [importId, row.id, taskId, row.item_key]);
      }

      for (const row of rows) {
        const taskId = taskIds.get(row.item_key);
        for (const dependencyKey of row.depends_on_keys || []) {
          const dependencyId = taskIds.get(dependencyKey);
          if (!taskId || !dependencyId) throw new Error(`Template dependency ${dependencyKey} is unresolved.`);
          await client.query(`
            INSERT INTO task_dependencies (task_id, related_task_id, dependency_type)
            VALUES ($1, $2, 'blocked_by')
            ON CONFLICT DO NOTHING
          `, [taskId, dependencyId]);
        }
      }

      await client.query("COMMIT");
      return res.status(200).send(new ServerResponse(true, {
        import_id: importId,
        already_imported: false,
        created_count: rows.length,
        phase_id: phaseId,
      }, "Checklist installed successfully."));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
