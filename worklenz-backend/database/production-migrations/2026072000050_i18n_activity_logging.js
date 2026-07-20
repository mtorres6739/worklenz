exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE project_logs
      ADD COLUMN IF NOT EXISTS i18n_key TEXT,
      ADD COLUMN IF NOT EXISTS i18n_params JSONB,
      ADD COLUMN IF NOT EXISTS user_id UUID,
      ADD COLUMN IF NOT EXISTS user_name TEXT,
      ADD COLUMN IF NOT EXISTS project_name TEXT;

    ALTER TABLE task_activity_logs
      ADD COLUMN IF NOT EXISTS i18n_key TEXT,
      ADD COLUMN IF NOT EXISTS i18n_params JSONB;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'project_logs_user_id_fk'
      ) THEN
        ALTER TABLE project_logs
          ADD CONSTRAINT project_logs_user_id_fk
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END
    $$;

    CREATE INDEX IF NOT EXISTS idx_project_logs_i18n_key ON project_logs(i18n_key);
    CREATE INDEX IF NOT EXISTS idx_task_activity_logs_i18n_key ON task_activity_logs(i18n_key);

    CREATE OR REPLACE FUNCTION log_project_activity_i18n(
      _team_id UUID,
      _project_id UUID,
      _user_id UUID,
      _i18n_key TEXT,
      _i18n_params JSONB DEFAULT '{}',
      _project_name TEXT DEFAULT NULL
    ) RETURNS VOID
    LANGUAGE plpgsql
    AS $$
    DECLARE
      _user_name TEXT;
      _resolved_project_name TEXT;
    BEGIN
      SELECT name INTO _user_name FROM users WHERE id = _user_id;
      _resolved_project_name := _project_name;
      IF _resolved_project_name IS NULL THEN
        SELECT name INTO _resolved_project_name FROM projects WHERE id = _project_id;
      END IF;

      _i18n_params := COALESCE(_i18n_params, '{}'::JSONB) || jsonb_build_object(
        'userName', COALESCE(_user_name, 'Unknown User'),
        'projectName', COALESCE(_resolved_project_name, 'Unknown Project')
      );

      INSERT INTO project_logs (
        team_id, project_id, user_id, user_name, project_name,
        i18n_key, i18n_params, description
      ) VALUES (
        _team_id, _project_id, _user_id, _user_name, _resolved_project_name,
        _i18n_key, _i18n_params, 'Activity by ' || COALESCE(_user_name, 'Unknown User')
      );
    END;
    $$;

    CREATE OR REPLACE FUNCTION log_task_activity_i18n(
      _task_id UUID,
      _team_id UUID,
      _project_id UUID,
      _user_id UUID,
      _attribute_type TEXT,
      _log_type TEXT,
      _i18n_key TEXT,
      _i18n_params JSONB DEFAULT '{}',
      _old_value TEXT DEFAULT NULL,
      _new_value TEXT DEFAULT NULL
    ) RETURNS VOID
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO task_activity_logs (
        task_id, team_id, project_id, user_id, attribute_type, log_type,
        old_value, new_value, i18n_key, i18n_params
      ) VALUES (
        _task_id, _team_id, _project_id, _user_id, _attribute_type, _log_type,
        _old_value, _new_value, _i18n_key, COALESCE(_i18n_params, '{}'::JSONB)
      );
    END;
    $$;
  `);
};

// Keep compatible logging functions and columns available for rollback.
exports.down = (pgm) => {
  pgm.sql("SELECT 1");
};
