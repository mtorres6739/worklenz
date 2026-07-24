import express from "express";
import rateLimit from "express-rate-limit";

import StripePortalWebhookController from "../controllers/stripe-portal-webhook-controller";
import safeControllerFunction from "../shared/safe-controller-function";

const router = express.Router();
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
router.post(
  "/events",
  express.raw({ type: "application/json", limit: "1mb" }),
  safeControllerFunction(StripePortalWebhookController.handle),
);

export default router;
