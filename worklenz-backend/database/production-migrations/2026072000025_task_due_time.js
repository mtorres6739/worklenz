exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS due_time TIME;
  `);
};

// The task form function reads this column, including after application rollback.
exports.down = (pgm) => {
  pgm.sql("SELECT 1");
};
