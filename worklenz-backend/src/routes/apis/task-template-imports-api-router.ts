import express from "express";

import TasktemplatesController from "../../controllers/task-templates-controller";
import projectManagerValidator from "../../middlewares/validators/project-manager-validator";
import verifyProjectAccess from "../../middlewares/verify-project-access";
import safeControllerFunction from "../../shared/safe-controller-function";
import {isValidUuid} from "../../shared/validation-helpers";
import {ServerResponse} from "../../models/server-response";

const taskTemplateImportsApiRouter = express.Router({mergeParams: true});

taskTemplateImportsApiRouter.post(
  "/",
  (req, res, next) => {
    if (!isValidUuid(req.params.projectId)) {
      return res.status(400).send(new ServerResponse(false, null, "Invalid project ID."));
    }
    return next();
  },
  verifyProjectAccess("params", "projectId"),
  projectManagerValidator,
  safeControllerFunction(TasktemplatesController.importToProject),
);

export default taskTemplateImportsApiRouter;
