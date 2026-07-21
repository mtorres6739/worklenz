import db from "../config/db";
import { IPassportSession } from "../interfaces/passport-session";
import {
  getEffectiveTeamRole,
  hasTeamAdminPrivileges,
  TEAM_ROLE_NAMES,
} from "./team-permissions";

export async function canAccessProjectFinance(
  user: IPassportSession | undefined,
  projectId: string,
): Promise<boolean> {
  if (!user?.team_id || !projectId) return false;

  const projectResult = await db.query(
    `SELECT team_id FROM projects WHERE id = $1::UUID AND team_id = $2::UUID`,
    [projectId, user.team_id],
  );
  if (projectResult.rowCount === 0) return false;
  if (hasTeamAdminPrivileges(user)) return true;
  if (getEffectiveTeamRole(user) === TEAM_ROLE_NAMES.TEAM_LEAD) return false;
  if (!user.team_member_id) return false;

  const managerResult = await db.query(
    `SELECT 1
       FROM project_members pm
       JOIN project_access_levels pal ON pal.id = pm.project_access_level_id
      WHERE pm.project_id = $1::UUID
        AND pm.team_member_id = $2::UUID
        AND pal.key = 'PROJECT_MANAGER'
      LIMIT 1`,
    [projectId, user.team_member_id],
  );
  return managerResult.rowCount === 1;
}
