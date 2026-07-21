/**
 * SDM Client Portal collaboration foundation.
 *
 * This migration intentionally uses a normalized `portal_*` namespace. The public
 * repository contains several unfinished and mutually incompatible portal drafts;
 * production must not depend on their bearer-token tables or partially applied
 * constraints.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS email WL_EMAIL;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_name TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone_country_code TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_line_1 TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS city TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS state TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS zip_code TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS country TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_person TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_portal_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

    ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_portal_visible BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_portal_access_level TEXT NOT NULL DEFAULT 'view';

    CREATE UNIQUE INDEX IF NOT EXISTS clients_portal_scope_unique ON clients(id, team_id);
    CREATE UNIQUE INDEX IF NOT EXISTS projects_portal_scope_unique ON projects(id, team_id);
    CREATE UNIQUE INDEX IF NOT EXISTS tasks_portal_scope_unique ON tasks(id, project_id);

    CREATE TABLE IF NOT EXISTS portal_client_users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email WL_EMAIL NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT portal_client_users_status_check CHECK (status IN ('active', 'disabled')),
      CONSTRAINT portal_client_users_name_check CHECK (char_length(name) BETWEEN 1 AND 120)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS portal_client_users_email_unique
      ON portal_client_users (lower(email::TEXT));

    CREATE TABLE IF NOT EXISTS portal_client_memberships (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      client_user_id UUID NOT NULL REFERENCES portal_client_users(id) ON DELETE CASCADE,
      team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      access_level TEXT NOT NULL DEFAULT 'view',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
      accepted_at TIMESTAMPTZ,
      last_access_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT portal_membership_role_check CHECK (role IN ('admin', 'member')),
      CONSTRAINT portal_membership_access_check CHECK (access_level IN ('view', 'comment')),
      CONSTRAINT portal_membership_scope_unique UNIQUE (client_user_id, team_id, client_id),
      CONSTRAINT portal_membership_actor_scope_unique UNIQUE (id, client_user_id),
      CONSTRAINT portal_membership_comment_scope_unique UNIQUE (id, team_id, client_id),
      CONSTRAINT portal_membership_client_scope_fk FOREIGN KEY (client_id, team_id)
        REFERENCES clients(id, team_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS portal_invitations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      email WL_EMAIL NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      access_level TEXT NOT NULL DEFAULT 'view',
      token_hash CHAR(64) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      invited_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      accepted_by_client_user_id UUID REFERENCES portal_client_users(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT portal_invitation_role_check CHECK (role IN ('admin', 'member')),
      CONSTRAINT portal_invitation_access_check CHECK (access_level IN ('view', 'comment')),
      CONSTRAINT portal_invitation_status_check CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
      CONSTRAINT portal_invitation_token_unique UNIQUE (token_hash),
      CONSTRAINT portal_invitation_client_scope_fk FOREIGN KEY (client_id, team_id)
        REFERENCES clients(id, team_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS portal_sessions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      client_user_id UUID NOT NULL REFERENCES portal_client_users(id) ON DELETE CASCADE,
      membership_id UUID NOT NULL REFERENCES portal_client_memberships(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL,
      csrf_token CHAR(64) NOT NULL,
      audience TEXT NOT NULL DEFAULT 'client_portal',
      expires_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TIMESTAMPTZ,
      ip_address INET,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT portal_session_audience_check CHECK (audience = 'client_portal'),
      CONSTRAINT portal_session_token_unique UNIQUE (token_hash),
      CONSTRAINT portal_session_membership_actor_fk FOREIGN KEY (membership_id, client_user_id)
        REFERENCES portal_client_memberships(id, client_user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS portal_project_access (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      access_level TEXT NOT NULL DEFAULT 'view',
      can_view_files BOOLEAN NOT NULL DEFAULT TRUE,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT portal_project_access_level_check CHECK (access_level IN ('view', 'comment')),
      CONSTRAINT portal_project_access_unique UNIQUE (client_id, project_id),
      CONSTRAINT portal_project_access_project_unique UNIQUE (project_id),
      CONSTRAINT portal_project_access_client_scope_fk FOREIGN KEY (client_id, team_id)
        REFERENCES clients(id, team_id) ON DELETE CASCADE,
      CONSTRAINT portal_project_access_project_scope_fk FOREIGN KEY (project_id, team_id)
        REFERENCES projects(id, team_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS portal_task_comments (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      membership_id UUID REFERENCES portal_client_memberships(id) ON DELETE SET NULL,
      staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      sender_type TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT portal_comment_sender_check CHECK (sender_type IN ('client', 'staff')),
      CONSTRAINT portal_comment_actor_check CHECK (
        (sender_type = 'client' AND membership_id IS NOT NULL AND staff_user_id IS NULL)
        OR (sender_type = 'staff' AND membership_id IS NULL AND staff_user_id IS NOT NULL)
      ),
      CONSTRAINT portal_comment_length_check CHECK (char_length(comment) BETWEEN 1 AND 5000),
      CONSTRAINT portal_comment_membership_scope_fk FOREIGN KEY (membership_id, team_id, client_id)
        REFERENCES portal_client_memberships(id, team_id, client_id),
      CONSTRAINT portal_comment_client_scope_fk FOREIGN KEY (client_id, team_id)
        REFERENCES clients(id, team_id) ON DELETE CASCADE,
      CONSTRAINT portal_comment_project_scope_fk FOREIGN KEY (project_id, team_id)
        REFERENCES projects(id, team_id) ON DELETE CASCADE,
      CONSTRAINT portal_comment_task_scope_fk FOREIGN KEY (task_id, project_id)
        REFERENCES tasks(id, project_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS portal_task_views (
      membership_id UUID NOT NULL REFERENCES portal_client_memberships(id) ON DELETE CASCADE,
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (membership_id, task_id)
    );

    CREATE TABLE IF NOT EXISTS portal_password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      client_user_id UUID NOT NULL REFERENCES portal_client_users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS portal_audit_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
      client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
      client_user_id UUID REFERENCES portal_client_users(id) ON DELETE SET NULL,
      staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      success BOOLEAN NOT NULL DEFAULT TRUE,
      details JSONB NOT NULL DEFAULT '{}'::JSONB,
      ip_address INET,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_portal_memberships_user_active
      ON portal_client_memberships(client_user_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_portal_memberships_scope
      ON portal_client_memberships(team_id, client_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_portal_invitations_scope
      ON portal_invitations(team_id, client_id, status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_portal_sessions_user_expires
      ON portal_sessions(client_user_id, expires_at) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_portal_sessions_cleanup
      ON portal_sessions(expires_at, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_portal_project_access_scope
      ON portal_project_access(team_id, client_id, project_id);
    CREATE INDEX IF NOT EXISTS idx_portal_comments_task_created
      ON portal_task_comments(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_portal_comments_scope
      ON portal_task_comments(team_id, client_id, project_id);
    CREATE INDEX IF NOT EXISTS idx_portal_resets_cleanup
      ON portal_password_reset_tokens(expires_at, used_at);
    CREATE INDEX IF NOT EXISTS idx_portal_audit_scope_created
      ON portal_audit_log(team_id, client_id, created_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS portal_pending_invitation_unique
      ON portal_invitations(team_id, client_id, lower(email::TEXT))
      WHERE status = 'pending';

    CREATE INDEX IF NOT EXISTS idx_clients_portal_enabled
      ON clients(team_id, client_portal_enabled, status);
    CREATE INDEX IF NOT EXISTS idx_projects_portal_visible
      ON projects(team_id, client_portal_visible) WHERE client_portal_visible = TRUE;

    COMMENT ON TABLE portal_sessions IS
      'Separate client-portal audience. Only SHA-256 session token digests are stored.';
    COMMENT ON TABLE portal_project_access IS
      'Explicit tenant-scoped project grants for a client company.';
  `);
};

exports.down = () => {
  // Production portal identity and audit data is intentionally preserved.
};
