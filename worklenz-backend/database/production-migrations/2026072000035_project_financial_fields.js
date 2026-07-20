exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS budget NUMERIC DEFAULT 0;
  `);
};

// Project detail reads require these fields after application rollback.
exports.down = (pgm) => {
  pgm.sql("SELECT 1");
};
