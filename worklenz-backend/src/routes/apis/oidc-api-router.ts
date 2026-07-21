import express from "express";
import OidcController from "../../controllers/oidc-controller";
import safeControllerFunction from "../../shared/safe-controller-function";
import teamOwnerOrAdminValidator from "../../middlewares/validators/team-owner-or-admin-validator";
import { requireSelfHostedCapability } from "../../middlewares/validators/self-hosted-capability-validator";

const router = express.Router();
router.use(requireSelfHostedCapability("oidc"), teamOwnerOrAdminValidator);
router.get("/configuration", safeControllerFunction(OidcController.getConfig));
router.put("/configuration", safeControllerFunction(OidcController.saveConfig));
router.post("/test", safeControllerFunction(OidcController.test));

export default router;
