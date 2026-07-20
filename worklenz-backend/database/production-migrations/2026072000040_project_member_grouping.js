exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE project_members
      ADD COLUMN IF NOT EXISTS task_list_group_by TEXT DEFAULT 'status' NOT NULL,
      ADD COLUMN IF NOT EXISTS board_group_by TEXT DEFAULT 'status' NOT NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'project_members_task_list_group_by_check'
      ) THEN
        ALTER TABLE project_members
          ADD CONSTRAINT project_members_task_list_group_by_check
          CHECK (task_list_group_by IN ('status', 'priority', 'phase'));
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'project_members_board_group_by_check'
      ) THEN
        ALTER TABLE project_members
          ADD CONSTRAINT project_members_board_group_by_check
          CHECK (board_group_by IN ('status', 'priority', 'phase'));
      END IF;
    END
    $$;
  `);
};

// Project detail reads require these fields after application rollback.
exports.down = (pgm) => {
  pgm.sql("SELECT 1");
};
