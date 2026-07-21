import express from "express";
import SlackIntegrationController from "../../controllers/slack-integration-controller";
import safeControllerFunction from "../../shared/safe-controller-function";
import teamOwnerOrAdminValidator from "../../middlewares/validators/team-owner-or-admin-validator";
import { requireSelfHostedCapability } from "../../middlewares/validators/self-hosted-capability-validator";
import { channelConfigUpdateValidator, channelConfigValidator } from "../../middlewares/validators/slack-validators";

const router = express.Router();
router.use(requireSelfHostedCapability("slack"), teamOwnerOrAdminValidator);
router.get("/status", safeControllerFunction(SlackIntegrationController.status));
router.get("/install-url", safeControllerFunction(SlackIntegrationController.installUrl));
router.delete("/disconnect", safeControllerFunction(SlackIntegrationController.disconnect));
router.get("/channels", safeControllerFunction(SlackIntegrationController.channels));
router.post("/channels/refresh", safeControllerFunction(SlackIntegrationController.refreshChannels));
router.get("/channel-configs/organization", safeControllerFunction(SlackIntegrationController.organizationConfigs));
router.get("/channel-configs/project/:projectId", safeControllerFunction(SlackIntegrationController.projectConfigs));
router.get("/channel-configs", safeControllerFunction(SlackIntegrationController.configs));
router.post("/channel-configs", channelConfigValidator, safeControllerFunction(SlackIntegrationController.createConfig));
router.patch("/channel-configs/:id", channelConfigUpdateValidator, safeControllerFunction(SlackIntegrationController.updateConfig));
router.post("/channel-configs/:id/reactivate", safeControllerFunction(SlackIntegrationController.reactivateConfig));
router.delete("/channel-configs/:id", safeControllerFunction(SlackIntegrationController.deleteConfig));
router.post("/test-notification/:id", safeControllerFunction(SlackIntegrationController.test));

export default router;
