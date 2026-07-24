'use strict';

/**
 * Restore the one-time token store required by the current staff password-reset
 * flow. The upstream SQL migration is outside the controlled production chain,
 * so self-hosted deployments need an additive equivalent here.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      is_used BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
      ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash
      ON password_reset_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_is_used
      ON password_reset_tokens(is_used);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
      ON password_reset_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_lookup
      ON password_reset_tokens(token_hash, is_used, expires_at);

    COMMENT ON TABLE password_reset_tokens IS
      'One-time staff password reset tokens stored only as SHA-256 hashes.';
  `);
};

exports.down = () => {
  // Preserve live reset-token state for rollback compatibility.
};
