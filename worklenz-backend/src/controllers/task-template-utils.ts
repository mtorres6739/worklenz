export interface ITaskTemplateLabel {
  name: string;
  color_code: string;
}

export interface ITaskTemplateTaskInput {
  key?: string;
  name?: string;
  description?: string | null;
  total_minutes?: number | string | null;
  due_offset_days?: number | string | null;
  labels?: Array<string | Partial<ITaskTemplateLabel>>;
  depends_on_keys?: string[];
  sub_tasks?: ITaskTemplateTaskInput[];
}

export interface ITaskTemplateTaskRow {
  id?: string;
  item_key: string;
  parent_item_key: string | null;
  parent_task_name?: string | null;
  name: string;
  description: string | null;
  total_minutes: number;
  due_offset_days: number | null;
  labels: ITaskTemplateLabel[];
  depends_on_keys: string[];
  sort_order: number;
}

export interface ITaskTemplateTask extends ITaskTemplateTaskRow {
  key: string;
  sub_tasks: ITaskTemplateTask[];
}

const DEFAULT_LABEL_COLOR = "#1677ff";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function toInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function normalizeKey(value: unknown, fallback: string): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

function normalizeLabels(labels: ITaskTemplateTaskInput["labels"]): ITaskTemplateLabel[] {
  if (!Array.isArray(labels)) return [];

  const unique = new Map<string, ITaskTemplateLabel>();
  for (const label of labels) {
    const name = String(typeof label === "string" ? label : label?.name || "")
      .trim()
      .slice(0, 40);
    if (!name) continue;
    const requestedColor = typeof label === "string" ? "" : String(label?.color_code || "");
    unique.set(name.toLowerCase(), {
      name,
      color_code: HEX_COLOR.test(requestedColor) ? requestedColor : DEFAULT_LABEL_COLOR,
    });
  }
  return [...unique.values()];
}

export function flattenTemplateTasks(tasks: ITaskTemplateTaskInput[]): ITaskTemplateTaskRow[] {
  if (!Array.isArray(tasks)) throw new Error("Tasks are required.");

  const rows: ITaskTemplateTaskRow[] = [];
  const keys = new Set<string>();

  const visit = (
    input: ITaskTemplateTaskInput,
    parentItemKey: string | null,
    path: number[],
  ) => {
    const name = String(input?.name || "").trim();
    if (!name) throw new Error("Every template task requires a name.");

    const fallbackKey = `item-${path.join("-")}`;
    const itemKey = normalizeKey(input.key, fallbackKey);
    if (keys.has(itemKey)) throw new Error(`Duplicate template task key: ${itemKey}`);
    keys.add(itemKey);

    const dueOffset = input.due_offset_days;
    const row: ITaskTemplateTaskRow = {
      item_key: itemKey,
      parent_item_key: parentItemKey,
      name: name.slice(0, 500),
      description: input.description ? String(input.description).trim() : null,
      total_minutes: toInteger(input.total_minutes),
      due_offset_days:
        dueOffset === null || dueOffset === undefined || dueOffset === ""
          ? null
          : Math.min(3650, toInteger(dueOffset)),
      labels: normalizeLabels(input.labels),
      depends_on_keys: Array.isArray(input.depends_on_keys)
        ? [...new Set(input.depends_on_keys.map(key => normalizeKey(key, "")).filter(Boolean))]
        : [],
      sort_order: rows.length,
    };
    rows.push(row);

    for (const [index, child] of (input.sub_tasks || []).entries()) {
      visit(child, itemKey, [...path, index]);
    }
  };

  for (const [index, task] of tasks.entries()) visit(task, null, [index]);

  for (const row of rows) {
    for (const dependencyKey of row.depends_on_keys) {
      if (!keys.has(dependencyKey)) {
        throw new Error(`Unknown dependency key: ${dependencyKey}`);
      }
      if (dependencyKey === row.item_key) {
        throw new Error(`Task ${row.item_key} cannot depend on itself.`);
      }
    }
  }

  return rows;
}

export function buildTemplateTree(rows: ITaskTemplateTaskRow[]): ITaskTemplateTask[] {
  const ordered = [...rows].sort((left, right) => left.sort_order - right.sort_order);
  const nodes = new Map<string, ITaskTemplateTask>();
  const nameKeys = new Map<string, string>();

  for (const row of ordered) {
    const node: ITaskTemplateTask = { ...row, key: row.item_key, sub_tasks: [] };
    nodes.set(row.item_key, node);
    if (!nameKeys.has(row.name)) nameKeys.set(row.name, row.item_key);
  }

  const roots: ITaskTemplateTask[] = [];
  for (const row of ordered) {
    const node = nodes.get(row.item_key)!;
    const parentKey = row.parent_item_key ||
      (row.parent_task_name ? nameKeys.get(row.parent_task_name) || null : null);
    const parent = parentKey ? nodes.get(parentKey) : null;
    if (parent) parent.sub_tasks.push(node);
    else roots.push(node);
  }

  return roots;
}
