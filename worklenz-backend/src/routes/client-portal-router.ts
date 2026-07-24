import express, { NextFunction, Request, Response } from "express";

import ClientPortalAuthController from "../controllers/client-portal-auth-controller";
import ClientPortalCollaborationController from "../controllers/client-portal-collaboration-controller";
import ClientPortalServicesRequestsController from "../controllers/client-portal-services-requests-controller";
import ClientPortalInvoicesController from "../controllers/client-portal-invoices-controller";
import {
  requireClientCommentAccess,
  requireClientPortalCsrf,
  requireClientPortalSession,
} from "../middlewares/client-portal-auth";
import {
  invitationLimiter,
  loginLimiter,
} from "../middlewares/auth-rate-limiters";
import {
  portalRequestAttachmentLimiter,
  portalRequestCommentLimiter,
  portalRequestCreateLimiter,
  portalInvoiceCheckoutLimiter,
  portalInvoicePdfLimiter,
} from "../middlewares/client-portal-request-rate-limiters";
import portalRequestAttachmentUpload from "../middlewares/portal-request-attachment-upload";
import {
  resetPasswordLimiter,
  updatePasswordLimiter,
} from "../middlewares/reset-password-rate-limiter";
import { requireSelfHostedCapability } from "../middlewares/validators/self-hosted-capability-validator";
import { ServerResponse } from "../models/server-response";
import safeControllerFunction from "../shared/safe-controller-function";

const router = express.Router();

function enforcePortalOrigin(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  const configured = (
    process.env.APP_ORIGIN ||
    process.env.FRONTEND_URL ||
    ""
  ).replace(/\/+$/, "");
  if (origin && configured && origin !== configured) {
    return res
      .status(403)
      .send(new ServerResponse(false, null, "Invalid request origin"));
  }
  next();
}

router.use(enforcePortalOrigin);

router.get(
  "/invitation/:token",
  invitationLimiter,
  safeControllerFunction(ClientPortalAuthController.invitation),
);
router.post(
  "/invitation/:token/accept",
  invitationLimiter,
  safeControllerFunction(ClientPortalAuthController.acceptInvitation),
);
router.post(
  "/auth/login",
  loginLimiter,
  safeControllerFunction(ClientPortalAuthController.login),
);
router.post(
  "/auth/request-reset",
  resetPasswordLimiter,
  safeControllerFunction(ClientPortalAuthController.requestPasswordReset),
);
router.post(
  "/auth/reset",
  updatePasswordLimiter,
  safeControllerFunction(ClientPortalAuthController.resetPassword),
);

router.use(safeControllerFunction(requireClientPortalSession));
router.get(
  "/auth/session",
  safeControllerFunction(ClientPortalAuthController.session),
);
router.use(requireClientPortalCsrf);
router.post(
  "/auth/logout",
  safeControllerFunction(ClientPortalAuthController.logout),
);
router.post(
  "/auth/switch",
  safeControllerFunction(ClientPortalAuthController.switchMembership),
);

router.get(
  "/invoices",
  requireSelfHostedCapability("clientPortalInvoices"),
  safeControllerFunction(ClientPortalInvoicesController.list),
);
router.get(
  "/invoices/payment-settings",
  requireSelfHostedCapability("clientPortalPayments"),
  safeControllerFunction(ClientPortalInvoicesController.paymentSettings),
);
router.get(
  "/invoices/:id",
  requireSelfHostedCapability("clientPortalInvoices"),
  safeControllerFunction(ClientPortalInvoicesController.details),
);
router.post(
  "/invoices/:id/checkout",
  requireSelfHostedCapability("stripeCheckout"),
  portalInvoiceCheckoutLimiter,
  safeControllerFunction(ClientPortalInvoicesController.createCheckout),
);
router.post(
  "/invoices/:id/payment-evidence",
  requireSelfHostedCapability("clientPortalPayments"),
  portalRequestAttachmentLimiter,
  portalRequestAttachmentUpload,
  safeControllerFunction(ClientPortalInvoicesController.submitPaymentEvidence),
);
router.get(
  "/invoices/:id/download",
  requireSelfHostedCapability("clientPortalInvoices"),
  portalInvoicePdfLimiter,
  safeControllerFunction(ClientPortalInvoicesController.download),
);

router.get(
  "/notifications",
  requireSelfHostedCapability("clientPortalRequestNotifications"),
  safeControllerFunction(
    ClientPortalServicesRequestsController.notifications,
  ),
);
router.get(
  "/notifications/unread-count",
  requireSelfHostedCapability("clientPortalRequestNotifications"),
  safeControllerFunction(
    ClientPortalServicesRequestsController.notificationUnreadCount,
  ),
);
router.put(
  "/notifications/read-all",
  requireSelfHostedCapability("clientPortalRequestNotifications"),
  safeControllerFunction(
    ClientPortalServicesRequestsController.markAllNotificationsRead,
  ),
);
router.put(
  "/notifications/:id/read",
  requireSelfHostedCapability("clientPortalRequestNotifications"),
  safeControllerFunction(
    ClientPortalServicesRequestsController.markNotificationRead,
  ),
);

router.get(
  "/services",
  requireSelfHostedCapability("clientPortalServices"),
  safeControllerFunction(ClientPortalServicesRequestsController.services),
);
router.get(
  "/services/:id",
  requireSelfHostedCapability("clientPortalServices"),
  safeControllerFunction(ClientPortalServicesRequestsController.service),
);
router.get(
  "/requests",
  requireSelfHostedCapability("clientPortalRequests"),
  safeControllerFunction(ClientPortalServicesRequestsController.requests),
);
router.post(
  "/requests",
  requireSelfHostedCapability("clientPortalRequests"),
  requireClientCommentAccess,
  portalRequestCreateLimiter,
  safeControllerFunction(ClientPortalServicesRequestsController.createRequest),
);
router.get(
  "/requests/:id",
  requireSelfHostedCapability("clientPortalRequests"),
  safeControllerFunction(ClientPortalServicesRequestsController.request),
);
router.get(
  "/requests/:id/comments",
  requireSelfHostedCapability("clientPortalRequests"),
  safeControllerFunction(ClientPortalServicesRequestsController.comments),
);
router.post(
  "/requests/:id/comments",
  requireSelfHostedCapability("clientPortalRequests"),
  requireClientCommentAccess,
  portalRequestCommentLimiter,
  safeControllerFunction(ClientPortalServicesRequestsController.addComment),
);
router.get(
  "/requests/:id/attachments",
  requireSelfHostedCapability("clientPortalRequests"),
  safeControllerFunction(ClientPortalServicesRequestsController.attachments),
);
router.post(
  "/requests/:id/attachments",
  requireSelfHostedCapability("clientPortalRequests"),
  requireClientCommentAccess,
  portalRequestAttachmentLimiter,
  portalRequestAttachmentUpload,
  safeControllerFunction(
    ClientPortalServicesRequestsController.uploadAttachment,
  ),
);
router.get(
  "/requests/:id/attachments/:attachmentId/download",
  requireSelfHostedCapability("clientPortalRequests"),
  safeControllerFunction(
    ClientPortalServicesRequestsController.downloadAttachment,
  ),
);
router.delete(
  "/requests/:id/attachments/:attachmentId",
  requireSelfHostedCapability("clientPortalRequests"),
  requireClientCommentAccess,
  safeControllerFunction(
    ClientPortalServicesRequestsController.deleteAttachment,
  ),
);

router.get(
  "/dashboard",
  safeControllerFunction(ClientPortalCollaborationController.dashboard),
);
router.get(
  "/projects",
  safeControllerFunction(ClientPortalCollaborationController.projects),
);
router.get(
  "/projects/:projectId",
  safeControllerFunction(ClientPortalCollaborationController.project),
);
router.get(
  "/projects/:projectId/tasks",
  safeControllerFunction(ClientPortalCollaborationController.tasks),
);
router.get(
  "/projects/:projectId/tasks/:taskId",
  safeControllerFunction(ClientPortalCollaborationController.task),
);
router.get(
  "/projects/:projectId/tasks/:taskId/comments",
  safeControllerFunction(ClientPortalCollaborationController.comments),
);
router.post(
  "/projects/:projectId/tasks/:taskId/comments",
  requireClientCommentAccess,
  safeControllerFunction(ClientPortalCollaborationController.addComment),
);
router.get(
  "/projects/:projectId/files",
  safeControllerFunction(ClientPortalCollaborationController.files),
);
router.get(
  "/projects/:projectId/files/:fileId/download",
  safeControllerFunction(ClientPortalCollaborationController.downloadFile),
);

export default router;
