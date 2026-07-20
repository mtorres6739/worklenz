exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS business_plan_override BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS team_member_limit_override BOOLEAN NOT NULL DEFAULT TRUE;

    CREATE TABLE IF NOT EXISTS licensing_plan_tiers (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tier_name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS licensing_plan_trials (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      plan_tier_id UUID NOT NULL REFERENCES licensing_plan_tiers(id),
      trial_end_date TIMESTAMPTZ NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS licensing_pricing_plans (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name TEXT NOT NULL DEFAULT '',
      billing_type TEXT NOT NULL DEFAULT 'month',
      default_currency TEXT NOT NULL DEFAULT 'USD',
      paddle_id INTEGER UNIQUE
    );

    CREATE TABLE IF NOT EXISTS licensing_user_subscriptions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_plan_id INTEGER,
      plan_id UUID REFERENCES licensing_pricing_plans(id),
      unit_price NUMERIC,
      cancel_url TEXT,
      next_bill_date TEXT,
      cancellation_effective_date DATE,
      paused_at TEXT,
      paused_from TEXT,
      paused_reason TEXT,
      status TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS licensing_custom_subs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      end_date DATE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS licensing_coupon_codes (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      redeemed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      team_members_limit INTEGER NOT NULL DEFAULT 3,
      is_redeemed BOOLEAN NOT NULL DEFAULT FALSE,
      is_refunded BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE INDEX IF NOT EXISTS idx_licensing_plan_trials_user_active
      ON licensing_plan_trials(user_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_licensing_user_subscriptions_user_active
      ON licensing_user_subscriptions(user_id, active);
    CREATE INDEX IF NOT EXISTS idx_licensing_custom_subs_user
      ON licensing_custom_subs(user_id);
    CREATE INDEX IF NOT EXISTS idx_licensing_coupon_codes_redeemed_by
      ON licensing_coupon_codes(redeemed_by);
  `);
};

// Compatibility tables and columns must remain available for application rollback.
exports.down = (pgm) => {
  pgm.sql("SELECT 1");
};
