'use strict';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = async (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS organization_branding (
      organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      display_name TEXT,
      accent_color VARCHAR(7) NOT NULL DEFAULT '#1677ff',
      page_title TEXT NOT NULL DEFAULT 'SDM Projects',
      favicon_key TEXT,
      email_from_name TEXT,
      email_from_address TEXT,
      portal_appearance JSONB NOT NULL DEFAULT '{}'::JSONB,
      invoice_appearance JSONB NOT NULL DEFAULT '{}'::JSONB,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT organization_branding_accent_check
        CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
      CONSTRAINT organization_branding_title_check
        CHECK (char_length(page_title) BETWEEN 1 AND 80),
      CONSTRAINT organization_branding_display_name_check
        CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80),
      CONSTRAINT organization_branding_email_check
        CHECK (email_from_address IS NULL OR email_from_address ~* '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$')
    );

    CREATE TABLE IF NOT EXISTS oidc_providers (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      issuer TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret_encrypted TEXT NOT NULL,
      scopes TEXT[] NOT NULL DEFAULT ARRAY['openid', 'profile', 'email']::TEXT[],
      claim_mapping JSONB NOT NULL DEFAULT '{"email":"email","name":"name","subject":"sub"}'::JSONB,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT oidc_provider_organization_unique UNIQUE (organization_id),
      CONSTRAINT oidc_provider_issuer_https CHECK (issuer ~ '^https://'),
      CONSTRAINT oidc_provider_display_name_check CHECK (char_length(display_name) BETWEEN 1 AND 80)
    );

    CREATE TABLE IF NOT EXISTS oidc_identities (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      provider_id UUID NOT NULL REFERENCES oidc_providers(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      email_at_link TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TIMESTAMPTZ,
      CONSTRAINT oidc_identity_subject_unique UNIQUE (provider_id, subject),
      CONSTRAINT oidc_identity_user_unique UNIQUE (provider_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS integration_audit_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      integration TEXT NOT NULL,
      action TEXT NOT NULL,
      success BOOLEAN NOT NULL DEFAULT TRUE,
      details JSONB NOT NULL DEFAULT '{}'::JSONB,
      ip_address INET,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_integration_audit_org_created
      ON integration_audit_log(organization_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS slack_workspaces (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL,
      team_name TEXT NOT NULL,
      access_token_encrypted TEXT NOT NULL,
      bot_user_id TEXT,
      scope TEXT,
      authed_user_id TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      last_verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT slack_workspaces_org_team_unique UNIQUE (organization_id, team_id)
    );

    CREATE TABLE IF NOT EXISTS slack_users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      slack_workspace_id UUID NOT NULL REFERENCES slack_workspaces(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      slack_user_id TEXT NOT NULL,
      slack_username TEXT,
      slack_email TEXT,
      slack_display_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT slack_users_workspace_user_unique UNIQUE (slack_workspace_id, slack_user_id)
    );

    CREATE TABLE IF NOT EXISTS slack_channels (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      slack_workspace_id UUID NOT NULL REFERENCES slack_workspaces(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      is_private BOOLEAN NOT NULL DEFAULT FALSE,
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT slack_channels_workspace_channel_unique UNIQUE (slack_workspace_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS slack_channel_configs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      slack_channel_id UUID NOT NULL REFERENCES slack_channels(id) ON DELETE CASCADE,
      notification_types TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT slack_channel_configs_project_channel_unique UNIQUE (project_id, slack_channel_id)
    );

    CREATE TABLE IF NOT EXISTS slack_notifications (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      slack_channel_config_id UUID NOT NULL REFERENCES slack_channel_configs(id) ON DELETE CASCADE,
      notification_type TEXT NOT NULL,
      slack_message_ts TEXT,
      worklenz_entity_type TEXT,
      worklenz_entity_id UUID,
      message_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at TIMESTAMPTZ,
      CONSTRAINT slack_notification_status_check CHECK (status IN ('pending', 'sent', 'failed'))
    );

    CREATE TABLE IF NOT EXISTS slack_request_receipts (
      request_key TEXT PRIMARY KEY,
      request_type TEXT NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_slack_workspace_org_active
      ON slack_workspaces(organization_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_slack_channels_workspace
      ON slack_channels(slack_workspace_id, is_archived);
    CREATE INDEX IF NOT EXISTS idx_slack_configs_project
      ON slack_channel_configs(project_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_slack_notifications_status
      ON slack_notifications(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_slack_request_receipts_received
      ON slack_request_receipts(received_at);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} _pgm */
exports.down = async (_pgm) => {
  // Intentionally preserve identity links, encrypted integration state, and audit history.
  // Older application images ignore these additive tables.
};
