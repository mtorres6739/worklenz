import express from "express";
import RateCardController from "../../controllers/rate-card-controller";
import teamOwnerOrAdminValidator from "../../middlewares/validators/team-owner-or-admin-validator";
import safeControllerFunction from "../../shared/safe-controller-function";
import { requireSelfHostedCapability } from "../../middlewares/validators/self-hosted-capability-validator";

const rateCardApiRouter = express.Router();
rateCardApiRouter.use(requireSelfHostedCapability("projectFinance"));

rateCardApiRouter.get(
  "/",
  teamOwnerOrAdminValidator,
  safeControllerFunction(RateCardController.get),
);
rateCardApiRouter.get(
  "/:id",
  teamOwnerOrAdminValidator,
  safeControllerFunction(RateCardController.getById),
);
rateCardApiRouter.post(
  "/",
  teamOwnerOrAdminValidator,
  safeControllerFunction(RateCardController.create),
);
rateCardApiRouter.put(
  "/:id",
  teamOwnerOrAdminValidator,
  safeControllerFunction(RateCardController.update),
);
rateCardApiRouter.delete(
  "/:id",
  teamOwnerOrAdminValidator,
  safeControllerFunction(RateCardController.delete),
);

export default rateCardApiRouter;
