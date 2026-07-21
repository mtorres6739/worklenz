import Excel from "exceljs";
import db from "../config/db";
import HandleExceptions from "../decorators/handle-exceptions";
import { IWorkLenzRequest } from "../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../interfaces/worklenz-response";
import { ServerResponse } from "../models/server-response";
import { canAccessProjectFinance } from "../shared/finance-permissions";
import {
  calculateActualLaborCost,
  calculateEstimatedLaborCost,
  calculateFinanceTotals,
  FinanceCalculationMethod,
  formatFinanceDuration,
  roundMoney,
} from "../shared/project-finance-calculations";
import WorklenzControllerBase from "./worklenz-controller-base";

type FinanceMember = {
  team_member_id: string;
  project_member_id: string;
  name: string;
  email_notifications_enabled: boolean;
  avatar_url: string | null;
  user_id: string;
  email: string;
  socket_id: string | null;
  team_id: string;
  color_code: string;
  project_rate_card_role_id: string | null;
  rate: number;
  man_day_rate: number;
  job_title_id: string | null;
  job_title_name: string | null;
};

type FinanceTask = {
  id: string;
  name: string;
  parent_task_id?: string;
  billable: boolean;
  fixed_cost: number;
  total_minutes: number;
  estimated_man_days: number;
  estimated_seconds: number;
  estimated_hours: string;
  total_time_logged_seconds: number;
  total_time_logged: string;
  estimated_cost: number;
  actual_cost_from_logs: number;
  members: FinanceMember[];
  variance: number;
  total_budget: number;
  total_actual: number;
  sub_tasks_count: number;
  is_sub_task: boolean;
  actual_man_days: number | null;
  effort_variance_man_days: number | null;
  group_id: string;
  group_name: string;
  group_color: string;
  group_color_dark: string;
};

type ProjectFinanceRecord = {
  id: string;
  name: string;
  currency: string;
  budget: string | number;
  calculation_method: FinanceCalculationMethod;
  finance_hours_per_day: string | number;
};

const numberValue = (value: unknown) => Number(value || 0);

function normalizeMoney(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 999999999999) {
    throw new Error("Amount must be a non-negative number");
  }
  return roundMoney(amount);
}

function normalizeCurrency(value: unknown): string {
  const currency = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error("Currency must be a three-letter ISO code");
  return currency;
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
        "You are not authorized to view project finance",
      ),
    );
  return false;
}

async function getProject(
  projectId: string,
  teamId: string,
): Promise<ProjectFinanceRecord | null> {
  const result = await db.query(
    `SELECT id, name, UPPER(COALESCE(currency, 'USD')) AS currency, COALESCE(budget, 0) AS budget,
            calculation_method, finance_hours_per_day
       FROM projects
      WHERE id = $1::UUID AND team_id = $2::UUID`,
    [projectId, teamId],
  );
  return result.rows[0] || null;
}

function groupFields(groupBy: string) {
  if (groupBy === "priority") {
    return {
      id: "priority_id",
      name: "priority_name",
      color: "priority_color",
      dark: "priority_color_dark",
    };
  }
  if (groupBy === "phases") {
    return {
      id: "phase_id",
      name: "phase_name",
      color: "phase_color",
      dark: "phase_color",
    };
  }
  return {
    id: "status_id",
    name: "status_name",
    color: "status_color",
    dark: "status_color_dark",
  };
}

async function loadFinanceTasks(
  project: ProjectFinanceRecord,
  groupBy: string,
): Promise<FinanceTask[]> {
  const result = await db.query(
    `SELECT t.id, t.name, t.parent_task_id, COALESCE(t.billable, TRUE) AS billable,
            COALESCE(t.fixed_cost, 0) AS fixed_cost,
            COALESCE(t.total_minutes, 0) AS total_minutes,
            COALESCE(t.estimated_man_days, 0) AS estimated_man_days,
            t.status_id, ts.name AS status_name,
            stsc.color_code AS status_color, stsc.color_code_dark AS status_color_dark,
            t.priority_id, tp.name AS priority_name,
            tp.color_code AS priority_color, tp.color_code_dark AS priority_color_dark,
            tph.phase_id, pp.name AS phase_name, pp.color_code AS phase_color,
            COALESCE(logs.logged_seconds, 0) AS logged_seconds,
            COALESCE(logs.actual_hourly_cost, 0) AS actual_hourly_cost,
            COALESCE(logs.actual_man_day_cost, 0) AS actual_man_day_cost,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'team_member_id', tm.id,
                'project_member_id', pm.id,
                'name', u.name,
                'email_notifications_enabled', COALESCE(ns.email_notifications_enabled, TRUE),
                'avatar_url', u.avatar_url,
                'user_id', u.id,
                'email', u.email,
                'socket_id', u.socket_id,
                'team_id', tm.team_id,
                'color_code', '#70a6f3',
                'project_rate_card_role_id', COALESCE(explicit_role.id, title_role.id),
                'rate', COALESCE(explicit_role.rate, title_role.rate, 0),
                'man_day_rate', COALESCE(explicit_role.man_day_rate, title_role.man_day_rate, 0),
                'job_title_id', jt.id,
                'job_title_name', jt.name
              ) ORDER BY u.name)
              FROM tasks_assignees ta
              JOIN project_members pm ON pm.id = ta.project_member_id AND pm.project_id = t.project_id
              JOIN team_members tm ON tm.id = pm.team_member_id
              JOIN users u ON u.id = tm.user_id
              LEFT JOIN notification_settings ns ON ns.user_id = u.id AND ns.team_id = tm.team_id
              LEFT JOIN job_titles jt ON jt.id = tm.job_title_id
              LEFT JOIN project_rate_card_roles explicit_role ON explicit_role.id = pm.project_rate_card_role_id
              LEFT JOIN project_rate_card_roles title_role
                ON title_role.project_id = t.project_id
               AND title_role.job_title_id = tm.job_title_id
               AND pm.project_rate_card_role_id IS NULL
              WHERE ta.task_id = t.id
            ), '[]'::JSONB) AS members
       FROM tasks t
       JOIN task_statuses ts ON ts.id = t.status_id
       JOIN sys_task_status_categories stsc ON stsc.id = ts.category_id
       JOIN task_priorities tp ON tp.id = t.priority_id
       LEFT JOIN task_phase tph ON tph.task_id = t.id
       LEFT JOIN project_phases pp ON pp.id = tph.phase_id
       LEFT JOIN LATERAL (
         SELECT SUM(twl.time_spent)::NUMERIC AS logged_seconds,
                SUM((twl.time_spent / 3600.0) * COALESCE(fwrs.hourly_rate, 0)) AS actual_hourly_cost,
                SUM((twl.time_spent / ($2::NUMERIC * 3600.0)) * COALESCE(fwrs.man_day_rate, 0)) AS actual_man_day_cost
           FROM task_work_log twl
           LEFT JOIN finance_work_log_rate_snapshots fwrs ON fwrs.work_log_id = twl.id
          WHERE twl.task_id = t.id
       ) logs ON TRUE
      WHERE t.project_id = $1::UUID
        AND t.archived = FALSE
      ORDER BY t.sort_order, t.created_at`,
    [project.id, numberValue(project.finance_hours_per_day) || 8],
  );

  const fields = groupFields(groupBy);
  return result.rows.map((row) => {
    const members = (row.members || []).map((member: FinanceMember) => ({
      ...member,
      rate: numberValue(member.rate),
      man_day_rate: numberValue(member.man_day_rate),
    }));
    const totalMinutes = numberValue(row.total_minutes);
    const estimatedManDays = numberValue(row.estimated_man_days);
    const loggedSeconds = numberValue(row.logged_seconds);
    const fixedCost = numberValue(row.fixed_cost);
    const estimatedCost = calculateEstimatedLaborCost(
      totalMinutes,
      estimatedManDays,
      members,
      project.calculation_method,
    );
    const actualCost = calculateActualLaborCost(
      loggedSeconds,
      numberValue(row.actual_hourly_cost),
      numberValue(row.actual_man_day_cost),
      project.calculation_method,
    );
    const totals = calculateFinanceTotals(estimatedCost, actualCost, fixedCost);
    const actualManDays =
      loggedSeconds /
      ((numberValue(project.finance_hours_per_day) || 8) * 3600);
    return {
      id: row.id,
      name: row.name,
      parent_task_id: row.parent_task_id || undefined,
      billable: row.billable,
      fixed_cost: fixedCost,
      total_minutes: totalMinutes,
      estimated_man_days: estimatedManDays,
      estimated_seconds: totalMinutes * 60,
      estimated_hours: formatFinanceDuration(totalMinutes * 60),
      total_time_logged_seconds: loggedSeconds,
      total_time_logged: formatFinanceDuration(loggedSeconds),
      estimated_cost: estimatedCost,
      actual_cost_from_logs: actualCost,
      members,
      variance: totals.variance,
      total_budget: totals.totalBudget,
      total_actual: totals.totalActual,
      sub_tasks_count: 0,
      is_sub_task: Boolean(row.parent_task_id),
      actual_man_days:
        project.calculation_method === "man_days"
          ? roundMoney(actualManDays)
          : null,
      effort_variance_man_days:
        project.calculation_method === "man_days"
          ? roundMoney(estimatedManDays - actualManDays)
          : null,
      group_id: String(row[fields.id] || "ungrouped"),
      group_name: String(row[fields.name] || "No group"),
      group_color: String(row[fields.color] || "#888888"),
      group_color_dark: String(
        row[fields.dark] || row[fields.color] || "#888888",
      ),
    };
  });
}

function selectTasksByBillableFilter(
  tasks: FinanceTask[],
  billableFilter: string,
): FinanceTask[] {
  if (billableFilter === "all") return tasks;

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const parentIds = new Set(
    tasks.map((task) => task.parent_task_id).filter(Boolean) as string[],
  );
  const included = new Set<string>();
  const targetBillable = billableFilter === "billable";

  for (const task of tasks) {
    // Parent rows are aggregates; the filter applies to the descendant billable units.
    if (parentIds.has(task.id) || task.billable !== targetBillable) continue;
    included.add(task.id);
    let parentId = task.parent_task_id;
    while (parentId) {
      included.add(parentId);
      parentId = byId.get(parentId)?.parent_task_id;
    }
  }

  return tasks.filter((task) => included.has(task.id));
}

function groupTopLevelTasks(tasks: FinanceTask[]) {
  const childCounts = new Map<string, number>();
  for (const task of tasks) {
    if (task.parent_task_id)
      childCounts.set(
        task.parent_task_id,
        (childCounts.get(task.parent_task_id) || 0) + 1,
      );
  }
  const groups = new Map<
    string,
    {
      group_id: string;
      group_name: string;
      color_code: string;
      color_code_dark: string;
      tasks: FinanceTask[];
    }
  >();
  for (const task of tasks.filter((item) => !item.parent_task_id)) {
    task.sub_tasks_count = childCounts.get(task.id) || 0;
    const key = task.group_id;
    if (!groups.has(key)) {
      groups.set(key, {
        group_id: key,
        group_name: task.group_name,
        color_code: task.group_color,
        color_code_dark: task.group_color_dark,
        tasks: [],
      });
    }
    groups.get(key)?.tasks.push(task);
  }
  return Array.from(groups.values());
}

/**
 * Parent rows represent their descendants, not a second billable unit. This keeps collapsed
 * finance tables accurate and prevents parent estimates from being counted again when children
 * are expanded. Fixed costs are already restricted to leaf tasks.
 */
function rollupTaskHierarchy(tasks: FinanceTask[]): FinanceTask[] {
  const children = new Map<string, FinanceTask[]>();
  for (const task of tasks) {
    if (!task.parent_task_id) continue;
    const siblings = children.get(task.parent_task_id) || [];
    siblings.push(task);
    children.set(task.parent_task_id, siblings);
  }

  const visiting = new Set<string>();
  const rollup = (task: FinanceTask): FinanceTask => {
    const descendants = children.get(task.id) || [];
    task.sub_tasks_count = descendants.length;
    if (!descendants.length || visiting.has(task.id)) return task;

    visiting.add(task.id);
    const rolledChildren = descendants.map(rollup);
    visiting.delete(task.id);

    task.total_minutes = rolledChildren.reduce(
      (sum, child) => sum + child.total_minutes,
      0,
    );
    task.estimated_man_days = roundMoney(
      rolledChildren.reduce((sum, child) => sum + child.estimated_man_days, 0),
    );
    task.estimated_seconds = rolledChildren.reduce(
      (sum, child) => sum + child.estimated_seconds,
      0,
    );
    task.estimated_hours = formatFinanceDuration(task.estimated_seconds);
    task.total_time_logged_seconds = rolledChildren.reduce(
      (sum, child) => sum + child.total_time_logged_seconds,
      0,
    );
    task.total_time_logged = formatFinanceDuration(
      task.total_time_logged_seconds,
    );
    task.estimated_cost = roundMoney(
      rolledChildren.reduce((sum, child) => sum + child.estimated_cost, 0),
    );
    task.actual_cost_from_logs = roundMoney(
      rolledChildren.reduce(
        (sum, child) => sum + child.actual_cost_from_logs,
        0,
      ),
    );
    task.fixed_cost = roundMoney(
      rolledChildren.reduce((sum, child) => sum + child.fixed_cost, 0),
    );
    const totals = calculateFinanceTotals(
      task.estimated_cost,
      task.actual_cost_from_logs,
      task.fixed_cost,
    );
    task.total_budget = totals.totalBudget;
    task.total_actual = totals.totalActual;
    task.variance = totals.variance;
    task.actual_man_days = roundMoney(
      rolledChildren.reduce(
        (sum, child) => sum + numberValue(child.actual_man_days),
        0,
      ),
    );
    task.effort_variance_man_days = roundMoney(
      rolledChildren.reduce(
        (sum, child) => sum + numberValue(child.effort_variance_man_days),
        0,
      ),
    );
    const uniqueMembers = new Map<string, FinanceMember>();
    for (const child of rolledChildren)
      for (const member of child.members)
        uniqueMembers.set(member.project_member_id, member);
    task.members = Array.from(uniqueMembers.values());
    return task;
  };

  tasks.forEach(rollup);
  return tasks;
}

async function projectRateCards(projectId: string) {
  const result = await db.query(
    `SELECT prcr.id, prcr.project_id, prcr.job_title_id, prcr.rate, prcr.man_day_rate,
            jt.name AS job_title_name
       FROM project_rate_card_roles prcr
       JOIN job_titles jt ON jt.id = prcr.job_title_id
      WHERE prcr.project_id = $1::UUID ORDER BY jt.name`,
    [projectId],
  );
  return result.rows;
}

export default class ProjectFinanceController extends WorklenzControllerBase {
  @HandleExceptions()
  public static async getProjectTasks(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    if (!(await authorize(req, res, req.params.projectId))) return res;
    const project = await getProject(
      req.params.projectId,
      req.user?.team_id as string,
    );
    if (!project)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Project not found"));
    const groupBy = ["status", "priority", "phases"].includes(
      String(req.query.group_by),
    )
      ? String(req.query.group_by)
      : "status";
    const billableFilter = ["all", "billable", "non-billable"].includes(
      String(req.query.billable_filter),
    )
      ? String(req.query.billable_filter)
      : "billable";
    const tasks = rollupTaskHierarchy(
      selectTasksByBillableFilter(
        await loadFinanceTasks(project, groupBy),
        billableFilter,
      ),
    );
    return res.status(200).send(
      new ServerResponse(true, {
        groups: groupTopLevelTasks(tasks),
        project_rate_cards: await projectRateCards(project.id),
        project: {
          id: project.id,
          name: project.name,
          currency: project.currency,
          calculation_method: project.calculation_method,
          hours_per_day: numberValue(project.finance_hours_per_day),
          budget: numberValue(project.budget),
        },
      }),
    );
  }

  @HandleExceptions()
  public static async getSubTasks(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    if (!(await authorize(req, res, req.params.projectId))) return res;
    const project = await getProject(
      req.params.projectId,
      req.user?.team_id as string,
    );
    if (!project)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Project not found"));
    const billableFilter = ["all", "billable", "non-billable"].includes(
      String(req.query.billable_filter),
    )
      ? String(req.query.billable_filter)
      : "billable";
    const tasks = rollupTaskHierarchy(
      selectTasksByBillableFilter(
        await loadFinanceTasks(project, "status"),
        billableFilter,
      ),
    );
    const children = tasks.filter(
      (task) => task.parent_task_id === req.params.parentTaskId,
    );
    const counts = new Map<string, number>();
    for (const task of tasks)
      if (task.parent_task_id)
        counts.set(
          task.parent_task_id,
          (counts.get(task.parent_task_id) || 0) + 1,
        );
    children.forEach((task) => {
      task.sub_tasks_count = counts.get(task.id) || 0;
    });
    return res.status(200).send(new ServerResponse(true, children));
  }

  @HandleExceptions()
  public static async getTaskBreakdown(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const taskResult = await db.query(
      `SELECT t.id, t.name, t.project_id, COALESCE(t.billable, TRUE) AS billable,
              COALESCE(t.total_minutes, 0) AS total_minutes, COALESCE(t.estimated_man_days, 0) AS estimated_man_days,
              COALESCE(t.fixed_cost, 0) AS fixed_cost, p.calculation_method, p.finance_hours_per_day
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.id = $1::UUID AND p.team_id = $2::UUID`,
      [req.params.taskId, req.user?.team_id],
    );
    if (taskResult.rowCount === 0)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Task not found"));
    const task = taskResult.rows[0];
    if (!(await authorize(req, res, task.project_id))) return res;
    const membersResult = await db.query(
      `SELECT tm.id AS team_member_id, u.name, u.avatar_url, jt.name AS job_title_name,
              COALESCE(explicit_role.rate, title_role.rate, 0) AS hourly_rate,
              COALESCE(explicit_role.man_day_rate, title_role.man_day_rate, 0) AS man_day_rate,
              EXISTS(SELECT 1 FROM tasks_assignees ta WHERE ta.task_id = $1::UUID AND ta.team_member_id = tm.id) AS assigned,
              COALESCE((SELECT SUM(twl.time_spent) FROM task_work_log twl WHERE twl.task_id = $1::UUID AND twl.user_id = u.id), 0) AS logged_seconds,
              COALESCE((SELECT SUM((twl.time_spent / 3600.0) * fwrs.hourly_rate)
                          FROM task_work_log twl JOIN finance_work_log_rate_snapshots fwrs ON fwrs.work_log_id = twl.id
                         WHERE twl.task_id = $1::UUID AND twl.user_id = u.id), 0) AS actual_hourly_cost,
              COALESCE((SELECT SUM((twl.time_spent / ($3::NUMERIC * 3600.0)) * fwrs.man_day_rate)
                          FROM task_work_log twl JOIN finance_work_log_rate_snapshots fwrs ON fwrs.work_log_id = twl.id
                         WHERE twl.task_id = $1::UUID AND twl.user_id = u.id), 0) AS actual_man_day_cost
         FROM project_members pm
         JOIN team_members tm ON tm.id = pm.team_member_id
         JOIN users u ON u.id = tm.user_id
         LEFT JOIN job_titles jt ON jt.id = tm.job_title_id
         LEFT JOIN project_rate_card_roles explicit_role ON explicit_role.id = pm.project_rate_card_role_id
         LEFT JOIN project_rate_card_roles title_role
           ON title_role.project_id = pm.project_id AND title_role.job_title_id = tm.job_title_id
          AND pm.project_rate_card_role_id IS NULL
        WHERE pm.project_id = $2::UUID
          AND (EXISTS(SELECT 1 FROM tasks_assignees ta WHERE ta.task_id = $1::UUID AND ta.team_member_id = tm.id)
               OR EXISTS(SELECT 1 FROM task_work_log twl WHERE twl.task_id = $1::UUID AND twl.user_id = u.id))
        ORDER BY jt.name, u.name`,
      [
        req.params.taskId,
        task.project_id,
        numberValue(task.finance_hours_per_day) || 8,
      ],
    );
    const assignedCount = membersResult.rows.filter(
      (row) => row.assigned,
    ).length;
    const members = membersResult.rows.map((row) => {
      const estimatedUnits =
        row.assigned && assignedCount
          ? (task.calculation_method === "man_days"
              ? numberValue(task.estimated_man_days)
              : numberValue(task.total_minutes) / 60) / assignedCount
          : 0;
      const rate =
        task.calculation_method === "man_days"
          ? numberValue(row.man_day_rate)
          : numberValue(row.hourly_rate);
      const actualCost =
        task.calculation_method === "man_days"
          ? numberValue(row.actual_man_day_cost)
          : numberValue(row.actual_hourly_cost);
      return {
        team_member_id: row.team_member_id,
        name: row.name,
        avatar_url: row.avatar_url,
        hourly_rate: numberValue(row.hourly_rate),
        estimated_hours:
          task.calculation_method === "man_days"
            ? estimatedUnits * (numberValue(task.finance_hours_per_day) || 8)
            : estimatedUnits,
        logged_hours: numberValue(row.logged_seconds) / 3600,
        estimated_cost: roundMoney(estimatedUnits * rate),
        actual_cost: roundMoney(actualCost),
        job_title_name: row.job_title_name || "Unassigned role",
      };
    });
    const estimatedLabor = roundMoney(
      members.reduce((sum, member) => sum + member.estimated_cost, 0),
    );
    const actualLabor = roundMoney(
      members.reduce((sum, member) => sum + member.actual_cost, 0),
    );
    const grouped = new Map<string, typeof members>();
    for (const member of members) {
      if (!grouped.has(member.job_title_name))
        grouped.set(member.job_title_name, []);
      grouped.get(member.job_title_name)?.push(member);
    }
    return res.status(200).send(
      new ServerResponse(true, {
        task: {
          id: task.id,
          name: task.name,
          project_id: task.project_id,
          billable: task.billable,
          estimated_hours: numberValue(task.total_minutes) / 60,
          logged_hours: members.reduce(
            (sum, member) => sum + member.logged_hours,
            0,
          ),
          estimated_labor_cost: estimatedLabor,
          actual_labor_cost: actualLabor,
          fixed_cost: numberValue(task.fixed_cost),
          total_estimated_cost: roundMoney(
            estimatedLabor + numberValue(task.fixed_cost),
          ),
          total_actual_cost: roundMoney(
            actualLabor + numberValue(task.fixed_cost),
          ),
        },
        grouped_members: Array.from(grouped.entries()).map(
          ([jobRole, roleMembers]) => ({
            jobRole,
            estimated_hours: roleMembers.reduce(
              (sum, member) => sum + member.estimated_hours,
              0,
            ),
            logged_hours: roleMembers.reduce(
              (sum, member) => sum + member.logged_hours,
              0,
            ),
            estimated_cost: roundMoney(
              roleMembers.reduce(
                (sum, member) => sum + member.estimated_cost,
                0,
              ),
            ),
            actual_cost: roundMoney(
              roleMembers.reduce((sum, member) => sum + member.actual_cost, 0),
            ),
            members: roleMembers,
          }),
        ),
        members,
      }),
    );
  }

  @HandleExceptions()
  public static async updateTaskFixedCost(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const context = await db.query(
      "SELECT project_id FROM tasks WHERE id = $1::UUID",
      [req.params.taskId],
    );
    if (context.rowCount === 0)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Task not found"));
    if (!(await authorize(req, res, context.rows[0].project_id))) return res;
    const hasChildren = await db.query(
      "SELECT 1 FROM tasks WHERE parent_task_id = $1::UUID LIMIT 1",
      [req.params.taskId],
    );
    if (hasChildren.rowCount)
      return res
        .status(400)
        .send(
          new ServerResponse(
            false,
            null,
            "Fixed costs may only be entered on leaf tasks",
          ),
        );
    const result = await db.query(
      "UPDATE tasks SET fixed_cost = $2 WHERE id = $1::UUID RETURNING id, fixed_cost",
      [req.params.taskId, normalizeMoney(req.body.fixed_cost)],
    );
    return res.status(200).send(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
  public static async updateTaskEstimatedManDays(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const context = await db.query(
      "SELECT project_id FROM tasks WHERE id = $1::UUID",
      [req.params.taskId],
    );
    if (context.rowCount === 0)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Task not found"));
    if (!(await authorize(req, res, context.rows[0].project_id))) return res;
    const result = await db.query(
      "UPDATE tasks SET estimated_man_days = $2 WHERE id = $1::UUID RETURNING id, estimated_man_days",
      [req.params.taskId, normalizeMoney(req.body.estimated_man_days)],
    );
    return res.status(200).send(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
  public static async updateProjectCurrency(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    return this.updateProjectField(
      req,
      res,
      "currency",
      normalizeCurrency(req.body.currency),
    );
  }

  @HandleExceptions()
  public static async updateProjectBudget(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    return this.updateProjectField(
      req,
      res,
      "budget",
      normalizeMoney(req.body.budget),
    );
  }

  private static async updateProjectField(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
    field: "currency" | "budget",
    value: string | number,
  ) {
    if (!(await authorize(req, res, req.params.projectId))) return res;
    const result = await db.query(
      `UPDATE projects SET ${field} = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID AND team_id = $3::UUID RETURNING id, currency, budget`,
      [req.params.projectId, value, req.user?.team_id],
    );
    if (result.rowCount === 0)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Project not found"));
    return res.status(200).send(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
  public static async updateCalculationMethod(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    if (!(await authorize(req, res, req.params.projectId))) return res;
    const method = req.body.calculation_method;
    if (!(["hourly", "man_days"] as string[]).includes(method)) {
      return res
        .status(400)
        .send(new ServerResponse(false, null, "Invalid calculation method"));
    }
    const hoursPerDay = Number(req.body.hours_per_day || 8);
    if (!Number.isFinite(hoursPerDay) || hoursPerDay <= 0 || hoursPerDay > 24) {
      return res
        .status(400)
        .send(
          new ServerResponse(
            false,
            null,
            "Hours per day must be between 0 and 24",
          ),
        );
    }
    const result = await db.query(
      `UPDATE projects SET calculation_method = $2, finance_hours_per_day = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::UUID AND team_id = $4::UUID
       RETURNING id, calculation_method, finance_hours_per_day AS hours_per_day`,
      [req.params.projectId, method, hoursPerDay, req.user?.team_id],
    );
    if (result.rowCount === 0)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Project not found"));
    return res.status(200).send(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
  public static async updateManDayRate(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    const context = await db.query(
      "SELECT project_id FROM project_rate_card_roles WHERE id = $1::UUID",
      [req.params.rateCardRoleId],
    );
    if (context.rowCount === 0)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Rate-card role not found"));
    if (!(await authorize(req, res, context.rows[0].project_id))) return res;
    const result = await db.query(
      "UPDATE project_rate_card_roles SET man_day_rate = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::UUID RETURNING id, man_day_rate",
      [req.params.rateCardRoleId, normalizeMoney(req.body.man_day_rate)],
    );
    return res.status(200).send(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
  public static async exportProject(
    req: IWorkLenzRequest,
    res: IWorkLenzResponse,
  ): Promise<IWorkLenzResponse> {
    if (!(await authorize(req, res, req.params.projectId))) return res;
    const project = await getProject(
      req.params.projectId,
      req.user?.team_id as string,
    );
    if (!project)
      return res
        .status(404)
        .send(new ServerResponse(false, null, "Project not found"));
    const groupBy = ["status", "priority", "phases"].includes(
      String(req.query.groupBy),
    )
      ? String(req.query.groupBy)
      : "status";
    const billableFilter = ["all", "billable", "non-billable"].includes(
      String(req.query.billable_filter),
    )
      ? String(req.query.billable_filter)
      : "billable";
    const tasks = rollupTaskHierarchy(
      selectTasksByBillableFilter(
        await loadFinanceTasks(project, groupBy),
        billableFilter,
      ),
    );
    const workbook = new Excel.Workbook();
    const sheet = workbook.addWorksheet("Project Finance");
    sheet.columns = [
      { header: "Task", key: "task", width: 40 },
      { header: "Group", key: "group", width: 24 },
      { header: "Billable", key: "billable", width: 12 },
      { header: "Estimated", key: "estimated", width: 16 },
      { header: "Logged", key: "logged", width: 16 },
      { header: "Estimated labor", key: "estimatedCost", width: 18 },
      { header: "Actual labor", key: "actualCost", width: 18 },
      { header: "Fixed cost", key: "fixedCost", width: 14 },
      { header: "Budget", key: "budget", width: 14 },
      { header: "Actual", key: "actual", width: 14 },
      { header: "Variance", key: "variance", width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const task of tasks)
      sheet.addRow({
        task: task.name,
        group: task.group_name,
        billable: task.billable ? "Yes" : "No",
        estimated: task.estimated_hours,
        logged: task.total_time_logged,
        estimatedCost: task.estimated_cost,
        actualCost: task.actual_cost_from_logs,
        fixedCost: task.fixed_cost,
        budget: task.total_budget,
        actual: task.total_actual,
        variance: task.variance,
      });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="project-finance-${project.id}.xlsx"`,
    );
    await workbook.xlsx.write(res);
    return res.end();
  }
}
