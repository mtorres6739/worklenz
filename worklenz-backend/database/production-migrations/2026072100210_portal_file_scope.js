/**
 * Add the project file table omitted from the controlled production chain and
 * enforce tenant/project scope on every file source exposed to Client Portal.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS project_files (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name TEXT NOT NULL,
      size BIGINT NOT NULL DEFAULT 0,
      type TEXT NOT NULL,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT project_files_name_check CHECK (char_length(name) <= 255)
    );

    CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_files_team_id ON project_files(team_id);
    CREATE INDEX IF NOT EXISTS idx_project_files_created_at ON project_files(created_at DESC);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'project_files'::regclass
           AND conname = 'project_files_project_scope_fk'
      ) THEN
        ALTER TABLE project_files
          ADD CONSTRAINT project_files_project_scope_fk
          FOREIGN KEY (project_id, team_id) REFERENCES projects(id, team_id)
          ON DELETE CASCADE NOT VALID;
      END IF;
    END $$;
    ALTER TABLE project_files VALIDATE CONSTRAINT project_files_project_scope_fk;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'task_attachments'::regclass
           AND conname = 'task_attachments_project_scope_fk'
      ) THEN
        ALTER TABLE task_attachments
          ADD CONSTRAINT task_attachments_project_scope_fk
          FOREIGN KEY (project_id, team_id) REFERENCES projects(id, team_id)
          ON DELETE CASCADE NOT VALID;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'task_attachments'::regclass
           AND conname = 'task_attachments_task_scope_fk'
      ) THEN
        ALTER TABLE task_attachments
          ADD CONSTRAINT task_attachments_task_scope_fk
          FOREIGN KEY (task_id, project_id) REFERENCES tasks(id, project_id)
          ON DELETE CASCADE NOT VALID;
      END IF;
    END $$;
    ALTER TABLE task_attachments VALIDATE CONSTRAINT task_attachments_project_scope_fk;
    ALTER TABLE task_attachments VALIDATE CONSTRAINT task_attachments_task_scope_fk;
  `);
};

exports.down = () => {
  // File metadata and tenant-scope constraints are intentionally preserved.
};

