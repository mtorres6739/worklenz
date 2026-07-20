exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_project_default_priority_trigger_fn() RETURNS TRIGGER AS
    $$
    BEGIN
      IF NEW.priority_id IS NULL THEN
        SELECT id
        FROM sys_project_priorities
        WHERE name = 'Medium'
        LIMIT 1
        INTO NEW.priority_id;
      END IF;

      RETURN NEW;
    END
    $$ LANGUAGE plpgsql;
  `);
};

// Keep the corrected trigger function available for application rollback.
exports.down = (pgm) => {
  pgm.sql("SELECT 1");
};
