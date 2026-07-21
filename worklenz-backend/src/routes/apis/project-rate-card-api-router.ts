import express from "express";
import ProjectRateCardController from "../../controllers/project-rate-card-controller";
import safeControllerFunction from "../../shared/safe-controller-function";
import { requireSelfHostedCapability } from "../../middlewares/validators/self-hosted-capability-validator";

const projectRateCardApiRouter = express.Router();
projectRateCardApiRouter.use(requireSelfHostedCapability("projectFinance"));

projectRateCardApiRouter.post(
  "/",
  safeControllerFunction(ProjectRateCardController.insertMany),
);
projectRateCardApiRouter.post(
  "/create-project-rate-card-role",
  safeControllerFunction(ProjectRateCardController.insertOne),
);
projectRateCardApiRouter.get(
  "/project/:projectId",
  safeControllerFunction(ProjectRateCardController.getFromProjectId),
);
projectRateCardApiRouter.put(
  "/project/:projectId/members/:memberId/rate-card-role",
  safeControllerFunction(ProjectRateCardController.updateMemberRole),
);
projectRateCardApiRouter.put(
  "/project/:projectId",
  safeControllerFunction(ProjectRateCardController.updateProject),
);
projectRateCardApiRouter.delete(
  "/project/:projectId",
  safeControllerFunction(ProjectRateCardController.deleteFromProjectId),
);
projectRateCardApiRouter.get(
  "/:id",
  safeControllerFunction(ProjectRateCardController.getFromId),
);
projectRateCardApiRouter.put(
  "/:id",
  safeControllerFunction(ProjectRateCardController.updateFromId),
);
projectRateCardApiRouter.delete(
  "/:id",
  safeControllerFunction(ProjectRateCardController.deleteFromId),
);

export default projectRateCardApiRouter;
