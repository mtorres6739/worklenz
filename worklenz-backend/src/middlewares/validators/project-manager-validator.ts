import {NextFunction} from "express";

import {IWorkLenzRequest} from "../../interfaces/worklenz-request";
import {IWorkLenzResponse} from "../../interfaces/worklenz-response";
import {ServerResponse} from "../../models/server-response";
import ProjectsController from "../../controllers/projects-controller";
import {
  getUserRoleInTeam,
  normalizeTeamRoleName,
  TEAM_ROLE_NAMES,
} from "../../shared/team-permissions";
import db from "../../config/db";

export default async function (req: IWorkLenzRequest, res: IWorkLenzResponse, next: NextFunction): Promise<IWorkLenzResponse | void> {

  let is_project_manager = false;
  let can_manage_team = false;

  const projectId = (req.query.current_project_id || req.params.projectId || req.params.id) as string | undefined;

  if (projectId) {
    const result = await ProjectsController.getProjectManager(projectId);
    if (result.length && req.user?.id && req.user?.team_id) {
      const currentMember = await db.query(
        `SELECT id FROM team_members WHERE user_id = $1 AND team_id = $2 LIMIT 1`,
        [req.user.id, req.user.team_id],
      );
      is_project_manager = result.some(row => row.team_member_id === currentMember.rows[0]?.id);
    }
  }

  // Resolve the role from the active team instead of trusting session flags that may
  // belong to a different team before verifyProjectAccess switched the active team.
  if (req.user?.id && req.user?.team_id) {
    const role = normalizeTeamRoleName(await getUserRoleInTeam(req.user.id, req.user.team_id));
    can_manage_team = role === TEAM_ROLE_NAMES.OWNER ||
      role === TEAM_ROLE_NAMES.ADMIN ||
      role === TEAM_ROLE_NAMES.TEAM_LEAD;
  }

  if (req.user && (can_manage_team || is_project_manager))
    return next();
  return res.status(401).send(new ServerResponse(false, null, "You are not authorized to perform this action"));
}
