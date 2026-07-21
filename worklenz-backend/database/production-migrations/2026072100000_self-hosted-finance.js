'use strict';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS calculation_method TEXT DEFAULT 'hourly' NOT NULL,
      ADD COLUMN IF NOT EXISTS finance_hours_per_day NUMERIC(5,2) DEFAULT 8 NOT NULL;

    ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS fixed_cost NUMERIC(14,2) DEFAULT 0 NOT NULL,
      ADD COLUMN IF NOT EXISTS estimated_man_days NUMERIC(10,2) DEFAULT 0 NOT NULL;

    CREATE TABLE IF NOT EXISTS finance_rate_cards (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'USD',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT finance_rate_cards_name_check CHECK (char_length(name) BETWEEN 1 AND 120),
      CONSTRAINT finance_rate_cards_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
      UNIQUE(team_id, name)
    );

    CREATE TABLE IF NOT EXISTS finance_rate_card_roles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      rate_card_id UUID NOT NULL REFERENCES finance_rate_cards(id) ON DELETE CASCADE,
      job_title_id UUID NOT NULL REFERENCES job_titles(id) ON DELETE CASCADE,
      rate NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
      man_day_rate NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (man_day_rate >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(rate_card_id, job_title_id)
    );

    CREATE TABLE IF NOT EXISTS project_rate_card_roles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      job_title_id UUID NOT NULL REFERENCES job_titles(id) ON DELETE CASCADE,
      rate NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
      man_day_rate NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (man_day_rate >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, job_title_id)
    );

    ALTER TABLE project_members
      ADD COLUMN IF NOT EXISTS project_rate_card_role_id UUID;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'project_members_finance_rate_role_fk'
          AND conrelid = 'project_members'::regclass
      ) THEN
        ALTER TABLE project_members
          ADD CONSTRAINT project_members_finance_rate_role_fk
          FOREIGN KEY (project_rate_card_role_id)
          REFERENCES project_rate_card_roles(id)
          ON DELETE SET NULL;
      END IF;
    END
    $$;

    CREATE TABLE IF NOT EXISTS finance_work_log_rate_snapshots (
      work_log_id UUID PRIMARY KEY REFERENCES task_work_log(id) ON DELETE CASCADE,
      project_rate_card_role_id UUID REFERENCES project_rate_card_roles(id) ON DELETE SET NULL,
      hourly_rate NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
      man_day_rate NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (man_day_rate >= 0),
      currency VARCHAR(3) NOT NULL DEFAULT 'USD',
      captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_finance_rate_cards_team
      ON finance_rate_cards(team_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_finance_rate_card_roles_card
      ON finance_rate_card_roles(rate_card_id);
    CREATE INDEX IF NOT EXISTS idx_project_rate_card_roles_project
      ON project_rate_card_roles(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_members_finance_role
      ON project_members(project_rate_card_role_id)
      WHERE project_rate_card_role_id IS NOT NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'projects_finance_calculation_method_check'
          AND conrelid = 'projects'::regclass
      ) THEN
        ALTER TABLE projects
          ADD CONSTRAINT projects_finance_calculation_method_check
          CHECK (calculation_method IN ('hourly', 'man_days'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'projects_finance_hours_per_day_check'
          AND conrelid = 'projects'::regclass
      ) THEN
        ALTER TABLE projects
          ADD CONSTRAINT projects_finance_hours_per_day_check
          CHECK (finance_hours_per_day > 0 AND finance_hours_per_day <= 24);
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION capture_finance_work_log_rate()
    RETURNS TRIGGER AS $$
    DECLARE
      rate_record RECORD;
    BEGIN
      SELECT
        COALESCE(explicit_role.id, title_role.id) AS role_id,
        COALESCE(explicit_role.rate, title_role.rate, 0) AS hourly_rate,
        COALESCE(explicit_role.man_day_rate, title_role.man_day_rate, 0) AS man_day_rate,
        COALESCE(p.currency, 'USD') AS currency
      INTO rate_record
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN team_members tm
        ON tm.user_id = NEW.user_id
       AND tm.team_id = p.team_id
      LEFT JOIN project_members pm
        ON pm.team_member_id = tm.id
       AND pm.project_id = p.id
      LEFT JOIN project_rate_card_roles explicit_role
        ON explicit_role.id = pm.project_rate_card_role_id
      LEFT JOIN project_rate_card_roles title_role
        ON title_role.project_id = p.id
       AND title_role.job_title_id = tm.job_title_id
       AND pm.project_rate_card_role_id IS NULL
      WHERE t.id = NEW.task_id
      LIMIT 1;

      INSERT INTO finance_work_log_rate_snapshots (
        work_log_id,
        project_rate_card_role_id,
        hourly_rate,
        man_day_rate,
        currency
      ) VALUES (
        NEW.id,
        rate_record.role_id,
        COALESCE(rate_record.hourly_rate, 0),
        COALESCE(rate_record.man_day_rate, 0),
        COALESCE(rate_record.currency, 'USD')
      )
      ON CONFLICT (work_log_id) DO NOTHING;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_capture_finance_work_log_rate ON task_work_log;
    CREATE TRIGGER trg_capture_finance_work_log_rate
      AFTER INSERT ON task_work_log
      FOR EACH ROW
      EXECUTE FUNCTION capture_finance_work_log_rate();

    INSERT INTO finance_work_log_rate_snapshots (
      work_log_id,
      project_rate_card_role_id,
      hourly_rate,
      man_day_rate,
      currency,
      captured_at
    )
    SELECT
      twl.id,
      COALESCE(explicit_role.id, title_role.id),
      COALESCE(explicit_role.rate, title_role.rate, 0),
      COALESCE(explicit_role.man_day_rate, title_role.man_day_rate, 0),
      COALESCE(p.currency, 'USD'),
      twl.created_at
    FROM task_work_log twl
    JOIN tasks t ON t.id = twl.task_id
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN team_members tm
      ON tm.user_id = twl.user_id
     AND tm.team_id = p.team_id
    LEFT JOIN project_members pm
      ON pm.team_member_id = tm.id
     AND pm.project_id = p.id
    LEFT JOIN project_rate_card_roles explicit_role
      ON explicit_role.id = pm.project_rate_card_role_id
    LEFT JOIN project_rate_card_roles title_role
      ON title_role.project_id = p.id
     AND title_role.job_title_id = tm.job_title_id
     AND pm.project_rate_card_role_id IS NULL
    ON CONFLICT (work_log_id) DO NOTHING;

    COMMENT ON TABLE finance_work_log_rate_snapshots IS
      'Immutable rate captured when a time log is created; migration backfill uses the current project rate.';
  `);
};

/**
 * Finance columns are retained on rollback because older application versions tolerate the
 * additive schema. Removing historical rate snapshots would rewrite finance history.
 */
exports.down = (pgm) => {
  pgm.sql('SELECT 1');
};
