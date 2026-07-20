exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS restrict_task_creation BOOLEAN DEFAULT FALSE NOT NULL;

    CREATE OR REPLACE FUNCTION is_task_creation_restricted(_user_id UUID, _project_id UUID)
    RETURNS BOOLEAN
    LANGUAGE plpgsql
    STABLE
    AS $$
    DECLARE
      _team_id UUID;
      _project_restricted BOOLEAN := FALSE;
      _org_restricted BOOLEAN := FALSE;
      _is_admin_or_lead BOOLEAN := FALSE;
    BEGIN
      SELECT team_id, COALESCE(restrict_task_creation, FALSE)
      INTO _team_id, _project_restricted
      FROM projects
      WHERE id = _project_id;

      IF _team_id IS NULL THEN
        RETURN FALSE;
      END IF;

      SELECT COALESCE(o.restrict_task_creation, FALSE)
      INTO _org_restricted
      FROM organizations o
      JOIN teams t ON t.user_id = o.user_id
      WHERE t.id = _team_id
      LIMIT 1;

      IF NOT (COALESCE(_project_restricted, FALSE) OR COALESCE(_org_restricted, FALSE)) THEN
        RETURN FALSE;
      END IF;

      SELECT COALESCE(r.admin_role OR r.owner, FALSE)
      INTO _is_admin_or_lead
      FROM team_members tm
      JOIN roles r ON tm.role_id = r.id
      WHERE tm.user_id = _user_id
        AND tm.team_id = _team_id
      LIMIT 1;

      RETURN NOT COALESCE(_is_admin_or_lead, FALSE);
    END;
    $$;
  `);
};

// Keep the helper available for application rollback.
exports.down = (pgm) => {
  pgm.sql("SELECT 1");
};
