import express from "express";
import SlackIntegrationController from "../controllers/slack-integration-controller";
import safeControllerFunction from "../shared/safe-controller-function";
import rateLimit from "express-rate-limit";

const router = express.Router();
router.use(rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));
router.post("/events", express.raw({ type: "application/json", limit: "1mb" }), safeControllerFunction(SlackIntegrationController.event));
router.post("/command", express.raw({ type: "application/x-www-form-urlencoded", limit: "256kb" }), safeControllerFunction(SlackIntegrationController.command));

export default router;
