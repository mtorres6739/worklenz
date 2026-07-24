'use strict';

/**
 * The controlled CE schema predates upstream Apple sign-in support, while
 * current authentication and password-reset queries select users.apple_id.
 * Keep the compatibility column even when Apple login is disabled so those
 * shared queries remain valid.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS apple_id TEXT;

    CREATE INDEX IF NOT EXISTS idx_users_apple_id
      ON users(apple_id);

    COMMENT ON COLUMN users.apple_id IS
      'Apple unique user identifier used by optional Apple sign-in.';
  `);
};

exports.down = () => {
  // Keep identity compatibility data for rollback to older application images.
};
