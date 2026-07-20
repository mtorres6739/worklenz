'use strict';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS calculation_method TEXT DEFAULT 'hourly',
      ADD COLUMN IF NOT EXISTS hours_per_day DOUBLE PRECISION DEFAULT 8,
      ADD COLUMN IF NOT EXISTS logo_url TEXT;

    UPDATE organizations
    SET calculation_method = COALESCE(calculation_method, 'hourly'),
        hours_per_day = COALESCE(hours_per_day, 8);

    ALTER TABLE organizations
      ALTER COLUMN calculation_method SET DEFAULT 'hourly',
      ALTER COLUMN calculation_method SET NOT NULL,
      ALTER COLUMN hours_per_day SET DEFAULT 8,
      ALTER COLUMN hours_per_day SET NOT NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'organizations_calculation_method_check'
          AND conrelid = 'organizations'::regclass
      ) THEN
        ALTER TABLE organizations
          ADD CONSTRAINT organizations_calculation_method_check
          CHECK (calculation_method IN ('hourly', 'man_days'));
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION get_task_complete_ratio(_task_id UUID) RETURNS JSON
      LANGUAGE plpgsql
    AS $$
    DECLARE
      _parent_task_done FLOAT := 0;
      _sub_tasks_done FLOAT := 0;
      _sub_tasks_count FLOAT := 0;
      _total_completed FLOAT := 0;
      _total_tasks FLOAT := 0;
      _ratio FLOAT := 0;
      _is_manual BOOLEAN := FALSE;
      _manual_value INTEGER := NULL;
    BEGIN
      SELECT COALESCE(manual_progress, FALSE), progress_value
      FROM tasks
      WHERE id = _task_id
      INTO _is_manual, _manual_value;

      IF _is_manual IS TRUE AND _manual_value IS NOT NULL THEN
        RETURN JSON_BUILD_OBJECT(
          'ratio', _manual_value,
          'total_completed', 0,
          'total_tasks', 0,
          'is_manual', TRUE
        );
      END IF;

      SELECT CASE
        WHEN EXISTS (
          SELECT 1
          FROM tasks_with_status_view
          WHERE task_id = _task_id AND is_done IS TRUE
        ) THEN 1
        ELSE 0
      END
      INTO _parent_task_done;

      SELECT COUNT(*)
      FROM tasks
      WHERE parent_task_id = _task_id AND archived IS FALSE
      INTO _sub_tasks_count;

      SELECT COUNT(*)
      FROM tasks_with_status_view
      WHERE parent_task_id = _task_id AND is_done IS TRUE
      INTO _sub_tasks_done;

      _total_completed := _parent_task_done + _sub_tasks_done;
      _total_tasks := _sub_tasks_count;

      IF _total_tasks > 0 THEN
        _ratio := (_total_completed / _total_tasks) * 100;
      ELSE
        _ratio := _parent_task_done * 100;
      END IF;

      RETURN JSON_BUILD_OBJECT(
        'ratio', _ratio,
        'total_completed', _total_completed,
        'total_tasks', _total_tasks,
        'is_manual', FALSE
      );
    END
    $$;
  `);
};

// Keep compatibility fields and the safe progress function for image rollback.
exports.down = (pgm) => {
  pgm.sql('SELECT 1');
};
