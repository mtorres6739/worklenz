import express from "express";
import ProjectFinanceController from "../../controllers/project-finance-controller";
import safeControllerFunction from "../../shared/safe-controller-function";
import { requireSelfHostedCapability } from "../../middlewares/validators/self-hosted-capability-validator";

const projectFinanceApiRouter = express.Router();
projectFinanceApiRouter.use(requireSelfHostedCapability("projectFinance"));

projectFinanceApiRouter.get(
  "/project/:projectId/tasks",
  safeControllerFunction(ProjectFinanceController.getProjectTasks),
);
projectFinanceApiRouter.get(
  "/project/:projectId/tasks/:parentTaskId/subtasks",
  safeControllerFunction(ProjectFinanceController.getSubTasks),
);
projectFinanceApiRouter.get(
  "/project/:projectId/export",
  safeControllerFunction(ProjectFinanceController.exportProject),
);
projectFinanceApiRouter.get(
  "/task/:taskId/breakdown",
  safeControllerFunction(ProjectFinanceController.getTaskBreakdown),
);
projectFinanceApiRouter.put(
  "/task/:taskId/fixed-cost",
  safeControllerFunction(ProjectFinanceController.updateTaskFixedCost),
);
projectFinanceApiRouter.put(
  "/task/:taskId/estimated-man-days",
  safeControllerFunction(ProjectFinanceController.updateTaskEstimatedManDays),
);
projectFinanceApiRouter.put(
  "/project/:projectId/currency",
  safeControllerFunction(ProjectFinanceController.updateProjectCurrency),
);
projectFinanceApiRouter.put(
  "/project/:projectId/budget",
  safeControllerFunction(ProjectFinanceController.updateProjectBudget),
);
projectFinanceApiRouter.put(
  "/project/:projectId/calculation-method",
  safeControllerFunction(ProjectFinanceController.updateCalculationMethod),
);
projectFinanceApiRouter.put(
  "/rate-card-role/:rateCardRoleId/man-day-rate",
  safeControllerFunction(ProjectFinanceController.updateManDayRate),
);

export default projectFinanceApiRouter;
