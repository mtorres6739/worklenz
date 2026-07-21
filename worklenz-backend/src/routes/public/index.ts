import express from "express";
import ClientsController from "../../controllers/clients-controller";
import safeControllerFunction from "../../shared/safe-controller-function";
import business from "../../business";
import OidcController from "../../controllers/oidc-controller";
import { SlackIntegrationService } from "../../services/slack-integration.service";

const public_router = express.Router();

public_router.post("/new-subscriber", safeControllerFunction(ClientsController.addSubscriber));
public_router.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});
public_router.get("/auth/providers", safeControllerFunction(OidcController.publicProvider));
public_router.get("/integrations/slack", (_req, res) => res.status(200).send(SlackIntegrationService.getAvailability()));

// Public business routes (e.g. Slack OAuth callback) — no-op in the open-core build.
business.registerBusinessPublicRoutes(public_router);

export default public_router;
