exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS sys_license_types (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name TEXT NOT NULL,
      key TEXT NOT NULL,
      description TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS sys_license_types_key_uindex
      ON sys_license_types(key);

    INSERT INTO sys_license_types (name, key)
    VALUES
      ('Custom Subscription', 'CUSTOM'),
      ('Free Trial', 'TRIAL'),
      ('Paddle Subscription', 'PADDLE'),
      ('Credit Subscription', 'CREDIT'),
      ('Free Plan', 'FREE'),
      ('Life Time Deal', 'LIFE_TIME_DEAL'),
      ('Self Hosted', 'SELF_HOSTED')
    ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name;
  `);
};

// Preserve license metadata for schema-compatible application rollbacks.
exports.down = (pgm) => {
  pgm.sql("SELECT 1");
};
