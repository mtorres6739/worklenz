'use strict';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE task_templates
      ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP WITH TIME ZONE;

    UPDATE task_templates template
    SET locked_at = COALESCE(template.locked_at, installed.first_imported_at)
    FROM (
      SELECT template_id, MIN(created_at) AS first_imported_at
      FROM task_template_imports
      GROUP BY template_id
    ) installed
    WHERE template.id = installed.template_id
      AND template.locked_at IS NULL;
  `);
};
