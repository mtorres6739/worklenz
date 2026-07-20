'use strict';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE task_templates
      ADD COLUMN IF NOT EXISTS template_key TEXT,
      ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL,
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS configuration JSONB DEFAULT '{}'::JSONB NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS task_templates_team_key_uindex
      ON task_templates(team_id, template_key)
      WHERE template_key IS NOT NULL;

    ALTER TABLE task_templates_tasks
      ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4(),
      ADD COLUMN IF NOT EXISTS parent_task_name TEXT,
      ADD COLUMN IF NOT EXISTS item_key TEXT,
      ADD COLUMN IF NOT EXISTS parent_item_key TEXT,
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS labels JSONB DEFAULT '[]'::JSONB NOT NULL,
      ADD COLUMN IF NOT EXISTS due_offset_days INTEGER,
      ADD COLUMN IF NOT EXISTS depends_on_keys TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
      ADD COLUMN IF NOT EXISTS sort_order INTEGER;

    UPDATE task_templates_tasks
    SET id = COALESCE(id, uuid_generate_v4())
    WHERE id IS NULL;

    UPDATE task_templates_tasks
    SET item_key = 'legacy-' || REPLACE(id::TEXT, '-', '')
    WHERE item_key IS NULL;

    WITH ordered AS (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY template_id ORDER BY ctid) - 1 AS next_sort_order
      FROM task_templates_tasks
      WHERE sort_order IS NULL
    )
    UPDATE task_templates_tasks target
    SET sort_order = ordered.next_sort_order
    FROM ordered
    WHERE target.id = ordered.id;

    ALTER TABLE task_templates_tasks
      ALTER COLUMN id SET DEFAULT uuid_generate_v4(),
      ALTER COLUMN id SET NOT NULL,
      ALTER COLUMN item_key SET DEFAULT ('legacy-' || REPLACE(uuid_generate_v4()::TEXT, '-', '')),
      ALTER COLUMN item_key SET NOT NULL,
      ALTER COLUMN sort_order SET DEFAULT 0,
      ALTER COLUMN sort_order SET NOT NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'task_templates_tasks_pk'
          AND conrelid = 'task_templates_tasks'::regclass
      ) THEN
        ALTER TABLE task_templates_tasks
          ADD CONSTRAINT task_templates_tasks_pk PRIMARY KEY (id);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'task_templates_tasks_template_item_key_uq'
          AND conrelid = 'task_templates_tasks'::regclass
      ) THEN
        ALTER TABLE task_templates_tasks
          ADD CONSTRAINT task_templates_tasks_template_item_key_uq
          UNIQUE (template_id, item_key);
      END IF;
    END
    $$;

    CREATE TABLE IF NOT EXISTS task_template_imports (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      template_id UUID NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
      template_version INTEGER DEFAULT 1 NOT NULL,
      destination_phase_id UUID REFERENCES project_phases(id) ON DELETE SET NULL,
      launch_target DATE,
      default_assignee_id UUID REFERENCES team_members(id) ON DELETE SET NULL,
      imported_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE (project_id, template_id)
    );

    CREATE TABLE IF NOT EXISTS task_template_import_items (
      import_id UUID NOT NULL REFERENCES task_template_imports(id) ON DELETE CASCADE,
      template_task_id UUID NOT NULL REFERENCES task_templates_tasks(id) ON DELETE CASCADE,
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      item_key TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
      PRIMARY KEY (import_id, template_task_id),
      UNIQUE (import_id, item_key),
      UNIQUE (task_id)
    );

    CREATE INDEX IF NOT EXISTS task_template_imports_project_index
      ON task_template_imports(project_id);
    CREATE INDEX IF NOT EXISTS task_template_import_items_task_index
      ON task_template_import_items(task_id);

    CREATE OR REPLACE FUNCTION can_update_task(_task_id uuid, _status_id uuid) RETURNS boolean
      LANGUAGE plpgsql
    AS
    $function$
    DECLARE
      can_continue BOOLEAN;
    BEGIN
      SELECT EXISTS (
        SELECT 1
        FROM task_statuses ts
        WHERE ts.id = _status_id
          AND ts.project_id = (SELECT project_id FROM tasks WHERE id = _task_id)
          AND ts.category_id IN (
            SELECT id FROM sys_task_status_categories WHERE is_done IS FALSE
          )
      ) INTO can_continue;

      IF can_continue THEN
        RETURN TRUE;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM task_template_import_items
        WHERE task_id = _task_id
          AND item_key = 'record-client-approval'
      ) AND NOT EXISTS (
        SELECT 1 FROM task_comments WHERE task_id = _task_id
        UNION ALL
        SELECT 1 FROM task_attachments WHERE task_id = _task_id
      ) THEN
        RETURN FALSE;
      END IF;

      SELECT NOT EXISTS (
        SELECT 1
        FROM task_dependencies td
        LEFT JOIN tasks t ON t.id = td.related_task_id
        WHERE td.task_id = _task_id
          AND t.status_id NOT IN (
            SELECT id
            FROM task_statuses ts
            WHERE t.project_id = ts.project_id
              AND ts.category_id IN (
                SELECT id FROM sys_task_status_categories WHERE is_done IS TRUE
              )
          )
      ) INTO can_continue;

      IF NOT can_continue THEN
        RETURN FALSE;
      END IF;

      SELECT NOT EXISTS (
        WITH RECURSIVE task_descendants AS (
          SELECT id, parent_task_id
          FROM tasks
          WHERE parent_task_id = _task_id AND archived IS FALSE

          UNION ALL

          SELECT child.id, child.parent_task_id
          FROM tasks child
          INNER JOIN task_descendants parent ON child.parent_task_id = parent.id
          WHERE child.archived IS FALSE
        )
        SELECT 1
        FROM task_descendants subtask
        INNER JOIN task_dependencies td ON td.task_id = subtask.id
        LEFT JOIN tasks dep_task ON dep_task.id = td.related_task_id
        WHERE dep_task.status_id NOT IN (
            SELECT id
            FROM task_statuses ts
            WHERE dep_task.project_id = ts.project_id
              AND ts.category_id IN (
                SELECT id FROM sys_task_status_categories WHERE is_done IS TRUE
              )
          )
      ) INTO can_continue;

      RETURN can_continue;
    END;
    $function$;
  `);
};

// Imported tasks and template metadata must remain readable after an image rollback.
exports.down = (pgm) => {
  pgm.sql('SELECT 1');
};
