exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS use_manual_progress BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS use_weighted_progress BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS use_time_progress BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS auto_assign_task_creator BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS restrict_task_creation BOOLEAN NOT NULL DEFAULT FALSE;
  `);
};

// Project policy columns must remain available for application rollback.
exports.down = (pgm) => {
  pgm.sql("SELECT 1");
};
