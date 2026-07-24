import express from "express";

import ClientPortalAdminController from "../../controllers/client-portal-admin-controller";
import ClientPortalServicesRequestsAdminController from "../../controllers/client-portal-services-requests-admin-controller";
import { requireSelfHostedCapability } from "../../middlewares/validators/self-hosted-capability-validator";
import teamOwnerOrAdminValidator from "../../middlewares/validators/team-owner-or-admin-validator";
import safeControllerFunction from "../../shared/safe-controller-function";

const router = express.Router();
router.use(teamOwnerOrAdminValidator);

router.get(
  "/dashboard",
  safeControllerFunction(ClientPortalAdminController.dashboard),
);
router.get(
  "/clients",
  safeControllerFunction(ClientPortalAdminController.listClients),
);
router.post(
  "/clients",
  safeControllerFunction(ClientPortalAdminController.createClient),
);
router.get(
  "/clients/:clientId",
  safeControllerFunction(ClientPortalAdminController.getClient),
);
router.get(
  "/clients/:clientId/details",
  safeControllerFunction(ClientPortalAdminController.getClient),
);
router.put(
  "/clients/:clientId",
  safeControllerFunction(ClientPortalAdminController.updateClient),
);
router.delete(
  "/clients/:clientId",
  safeControllerFunction(ClientPortalAdminController.deactivateClient),
);

router.get(
  "/clients/:clientId/projects",
  safeControllerFunction(ClientPortalAdminController.clientProjects),
);
router.post(
  "/clients/:clientId/projects",
  safeControllerFunction(ClientPortalAdminController.assignProject),
);
router.delete(
  "/clients/:clientId/projects/:projectId",
  safeControllerFunction(ClientPortalAdminController.removeProject),
);

router.get(
  "/clients/:clientId/team",
  safeControllerFunction(ClientPortalAdminController.clientTeam),
);
router.post(
  "/clients/:clientId/team",
  safeControllerFunction(ClientPortalAdminController.inviteTeamMember),
);
router.put(
  "/clients/:clientId/team/:memberId",
  safeControllerFunction(ClientPortalAdminController.updateTeamMember),
);
router.delete(
  "/clients/:clientId/team/:memberId",
  safeControllerFunction(ClientPortalAdminController.removeTeamMember),
);
router.post(
  "/clients/:clientId/team/:memberId/resend-invitation",
  safeControllerFunction(ClientPortalAdminController.resendTeamInvitation),
);

router.post(
  "/generate-invitation-link",
  safeControllerFunction(ClientPortalAdminController.generateInvitation),
);
router.post(
  "/clients/:clientId/resend-invitation",
  safeControllerFunction(ClientPortalAdminController.generateInvitation),
);

router.get(
  "/services",
  requireSelfHostedCapability("clientPortalServices"),
  safeControllerFunction(
    ClientPortalServicesRequestsAdminController.listServices,
  ),
);
router.post(
  "/services",
  requireSelfHostedCapability("clientPortalServices"),
  safeControllerFunction(
    ClientPortalServicesRequestsAdminController.createService,
  ),
);
router.get(
  "/services/:id",
  requireSelfHostedCapability("clientPortalServices"),
  safeControllerFunction(
    ClientPortalServicesRequestsAdminController.getService,
  ),
);
router.put(
  "/services/:id",
  requireSelfHostedCapability("clientPortalServices"),
  safeControllerFunction(
    ClientPortalServicesRequestsAdminController.updateService,
  ),
);
router.delete(
  "/services/:id",
  requireSelfHostedCapability("clientPortalServices"),
  safeControllerFunction(
    ClientPortalServicesRequestsAdminController.deactivateService,
  ),
);

router.get(
  "/requests/stats",
  requireSelfHostedCapability("clientPortalRequests"),
  safeControllerFunction(
    ClientPortalServicesRequestsAdminController.requestStats,
  ),
);
router.get(
  "/requests",
  requireSelfHostedCapability("clientPortalRequests"),
  safeControllerFunction(
    ClientPortalServicesRequestsAdminController.listRequests,
  ),
);
router.get(
  "/requests/:id",
  requireSelfHostedCapability("clientPortalRequests"),
  safeControllerFunction(
    ClientPortalServicesRequestsAdminController.getRequest,
  ),
);
router.put(
  "/requests/:id/status",
  requireSelfHostedCapability("clientPortalRequests"),
  safeControllerFunction(
    ClientPortalServicesRequestsAdminController.updateRequestStatus,
  ),
);
router.put(
  "/requests/:id/assign",
  requireSelfHostedCapability("clientPortalRequests"),
  safeControllerFunction(
    ClientPortalServicesRequestsAdminController.assignRequest,
  ),
);
router.get(
  "/requests/:id/comments",
  requireSelfHostedCapability("clientPortalRequests"),
  safeControllerFunction(ClientPortalServicesRequestsAdminController.comments),
);
router.post(
  "/requests/:id/comments",
  requireSelfHostedCapability("clientPortalRequests"),
  safeControllerFunction(
    ClientPortalServicesRequestsAdminController.addComment,
  ),
);

router.get(
  "/projects/:projectId/tasks/:taskId/comments",
  safeControllerFunction(ClientPortalAdminController.staffComments),
);
router.post(
  "/projects/:projectId/tasks/:taskId/comments",
  safeControllerFunction(ClientPortalAdminController.addStaffComment),
);

export default router;
