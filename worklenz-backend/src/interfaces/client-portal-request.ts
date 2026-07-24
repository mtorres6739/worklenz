import { Request } from "express";

export interface ClientPortalUploadMeta {
  cleanFileName: string;
  extension: string;
  mimeType: string;
}

export interface ClientPortalActor {
  sessionId: string;
  clientUserId: string;
  membershipId: string;
  teamId: string;
  clientId: string;
  email: string;
  name: string;
  role: "admin" | "member";
  accessLevel: "view" | "comment";
  csrfToken: string;
  expiresAt: string;
}

export interface ClientPortalRequest extends Request {
  portalActor?: ClientPortalActor;
  portalRequestFileMeta?: ClientPortalUploadMeta;
}
