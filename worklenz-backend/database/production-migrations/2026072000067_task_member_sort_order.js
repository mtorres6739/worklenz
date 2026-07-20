'use strict';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS member_sort_order INTEGER DEFAULT 0 NOT NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tasks_member_sort_order_check'
          AND conrelid = 'tasks'::regclass
      ) THEN
        ALTER TABLE tasks
          ADD CONSTRAINT tasks_member_sort_order_check
          CHECK (member_sort_order >= 0);
      END IF;
    END
    $$;

    CREATE INDEX IF NOT EXISTS idx_tasks_member_sort_order
      ON tasks(project_id, member_sort_order);

    COMMENT ON COLUMN tasks.member_sort_order IS
      'Sort order when grouped by assignee';
  `);
};
