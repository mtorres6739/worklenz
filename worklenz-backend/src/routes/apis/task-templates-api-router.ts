import express from "express";

import TasktemplatesController from "../../controllers/task-templates-controller";
import idParamValidator from "../../middlewares/validators/id-param-validator";
import importTaskTemplatesValidator from "../../middlewares/validators/import-task-templates-validator";
import bodyNameValidator from "../../middlewares/validators/body-name-validator";
import safeControllerFunction from "../../shared/safe-controller-function";
import projectManagerValidator from "../../middlewares/validators/project-manager-validator";
import teamOwnerOrAdminValidator from "../../middlewares/validators/team-owner-or-admin-validator";
import verifyProjectAccess from "../../middlewares/verify-project-access";

const taskTemplatesApiRouter = express.Router();

taskTemplatesApiRouter.post("/", teamOwnerOrAdminValidator, bodyNameValidator, safeControllerFunction(TasktemplatesController.create));
taskTemplatesApiRouter.post(
  "/import/:id",
  verifyProjectAccess("params", "id"),
  projectManagerValidator,
  importTaskTemplatesValidator,
  safeControllerFunction(TasktemplatesController.import),
);
taskTemplatesApiRouter.get("/", safeControllerFunction(TasktemplatesController.get));
taskTemplatesApiRouter.get("/:id", idParamValidator, safeControllerFunction(TasktemplatesController.getById));
taskTemplatesApiRouter.put("/:id", teamOwnerOrAdminValidator, idParamValidator, safeControllerFunction(TasktemplatesController.update));
taskTemplatesApiRouter.delete("/:id", teamOwnerOrAdminValidator, idParamValidator, safeControllerFunction(TasktemplatesController.deleteById));

export default taskTemplatesApiRouter;
