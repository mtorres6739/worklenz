'use strict';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'progress_mode_type'
      ) THEN
        CREATE TYPE progress_mode_type AS ENUM ('manual', 'weighted', 'time', 'default');
      END IF;
    END
    $$;

    ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS manual_progress BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS progress_value INTEGER DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS progress_mode progress_mode_type DEFAULT 'default',
      ADD COLUMN IF NOT EXISTS weight INTEGER DEFAULT NULL;

    ALTER TABLE team_members
      ADD COLUMN IF NOT EXISTS reports_to_member_id UUID;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_reports_to_member'
          AND conrelid = 'team_members'::regclass
      ) THEN
        ALTER TABLE team_members
          ADD CONSTRAINT fk_reports_to_member
          FOREIGN KEY (reports_to_member_id)
          REFERENCES team_members(id)
          ON DELETE SET NULL;
      END IF;
    END
    $$;

    CREATE INDEX IF NOT EXISTS idx_reports_to_member_id
      ON team_members(reports_to_member_id);
  `);
};

// Keep compatibility columns available for application-image rollback.
exports.down = (pgm) => {
  pgm.sql('SELECT 1');
};
