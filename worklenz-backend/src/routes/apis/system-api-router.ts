import express from "express";
import SystemController from "../../controllers/system-controller";
import safeControllerFunction from "../../shared/safe-controller-function";

const systemApiRouter = express.Router();

systemApiRouter.get(
  "/capabilities",
  safeControllerFunction(SystemController.getCapabilities),
);

export default systemApiRouter;
