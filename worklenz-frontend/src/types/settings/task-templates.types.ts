export interface ITaskTemplatesGetResponse {
  name?: string;
  id?: string;
  template_key?: string | null;
  version?: number;
  description?: string | null;
  configuration?: ITaskTemplateConfiguration;
  created_at?: string;
}

export interface ITaskTemplateLabel {
  name: string;
  color_code?: string;
}

export interface ITaskTemplateStatusConfiguration {
  name: string;
  category: 'todo' | 'doing' | 'done';
}

export interface ITaskTemplateConfiguration {
  phase?: { name?: string; color_code?: string };
  statuses?: ITaskTemplateStatusConfiguration[];
  default_status?: string;
}

/** Level-3: a subtask of a subtask (grandchild). No further nesting — matches DB 3-level limit. */
export interface ITaskTemplateGrandChildTask {
  id?: string;
  key?: string;
  item_key?: string;
  parent_item_key?: string | null;
  name: string;
  description?: string | null;
  total_minutes?: number;
  due_offset_days?: number | null;
  labels?: ITaskTemplateLabel[];
  depends_on_keys?: string[];
}

/** Level-2: a subtask of a parent task. May itself have sub_tasks (level-3). */
export interface ITaskTemplateSubTask {
  id?: string;
  key?: string;
  item_key?: string;
  parent_item_key?: string | null;
  name: string;
  description?: string | null;
  total_minutes?: number;
  due_offset_days?: number | null;
  labels?: ITaskTemplateLabel[];
  depends_on_keys?: string[];
  sub_tasks?: ITaskTemplateGrandChildTask[];
}

/** Level-1: a top-level template task. May have sub_tasks (level-2). */
export interface ITaskTemplateTask {
  id?: string;
  key?: string;
  item_key?: string;
  parent_item_key?: string | null;
  name: string;
  description?: string | null;
  total_minutes?: number;
  due_offset_days?: number | null;
  labels?: ITaskTemplateLabel[];
  depends_on_keys?: string[];
  sub_tasks?: ITaskTemplateSubTask[];
}

/**
 * Flat row sent to the import DB function.
 * - parent_task_name = null  → top-level task
 * - parent_task_name = <name> → subtask of that parent (any depth)
 */
export interface ITaskTemplateImportRow {
  name: string;
  total_minutes?: number;
  parent_task_name?: string | null;
}

export interface ITaskTemplateGetResponse {
  id?: string;
  name?: string;
  template_key?: string | null;
  version?: number;
  description?: string | null;
  configuration?: ITaskTemplateConfiguration;
  tasks?: ITaskTemplateTask[];
}

export interface ITaskTemplateImportRequest {
  template_id: string;
  launch_target: string;
  default_assignee_id: string;
  destination_phase: string;
}

export interface ITaskTemplateImportResponse {
  import_id: string;
  already_imported: boolean;
  created_count: number;
  phase_id?: string;
}
