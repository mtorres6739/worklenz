/**
 * Durable, tenant-scoped notifications for Client Portal service requests.
 *
 * Staff notifications continue to use the existing notification drawer while
 * client notifications stay inside the separate portal identity boundary.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_notifications
      ADD COLUMN IF NOT EXISTS portal_request_id UUID;

    DO $$
    BEGIN
      ALTER TABLE user_notifications
        ADD CONSTRAINT user_notifications_portal_request_id_fk
        FOREIGN KEY (portal_request_id)
        REFERENCES portal_requests(id) ON DELETE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END
    $$;

    CREATE INDEX IF NOT EXISTS idx_user_notifications_portal_request
      ON user_notifications(user_id, portal_request_id, created_at DESC)
      WHERE portal_request_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS portal_notifications (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      membership_id UUID NOT NULL REFERENCES portal_client_memberships(id)
        ON DELETE CASCADE,
      request_id UUID NOT NULL REFERENCES portal_requests(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      event_data JSONB NOT NULL DEFAULT '{}'::JSONB,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT portal_notifications_event_type_check CHECK (
        event_type IN (
          'request_created',
          'request_status_updated',
          'request_assigned',
          'request_comment_added',
          'request_attachment_added'
        )
      ),
      CONSTRAINT portal_notifications_title_check
        CHECK (char_length(title) BETWEEN 1 AND 160),
      CONSTRAINT portal_notifications_message_check
        CHECK (char_length(message) BETWEEN 1 AND 2000),
      CONSTRAINT portal_notifications_membership_scope_fk
        FOREIGN KEY (membership_id, team_id, client_id)
        REFERENCES portal_client_memberships(id, team_id, client_id)
        ON DELETE CASCADE,
      CONSTRAINT portal_notifications_request_scope_fk
        FOREIGN KEY (request_id, team_id, client_id)
        REFERENCES portal_requests(id, team_id, client_id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_portal_notifications_membership_unread
      ON portal_notifications(membership_id, created_at DESC)
      WHERE read_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_portal_notifications_scope_created
      ON portal_notifications(team_id, client_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_portal_notifications_request
      ON portal_notifications(request_id, created_at DESC);

    COMMENT ON TABLE portal_notifications IS
      'Request notifications scoped to one active client-portal membership.';
  `);
};

exports.down = () => {
  // Production notification history is intentionally preserved.
};
