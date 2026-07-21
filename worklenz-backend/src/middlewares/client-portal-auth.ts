import crypto from "crypto";
import { NextFunction, Response } from "express";

import { ClientPortalRequest } from "../interfaces/client-portal-request";
import { ServerResponse } from "../models/server-response";
import {
  clearPortalCookie,
  getPortalActorByRawToken,
  portalTokenFromRequest,
} from "../services/client-portal-session.service";

export async function requireClientPortalSession(
  req: ClientPortalRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> {
  const token = portalTokenFromRequest(req);
  if (!token) {
    return res.status(401).send(new ServerResponse(false, null, "Client portal authentication required"));
  }

  const actor = await getPortalActorByRawToken(token);
  if (!actor) {
    clearPortalCookie(res);
    return res.status(401).send(new ServerResponse(false, null, "Client portal session expired"));
  }

  req.portalActor = actor;
  next();
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireClientPortalCsrf(
  req: ClientPortalRequest,
  res: Response,
  next: NextFunction,
): void | Response {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const supplied = req.get("x-client-csrf") || "";
  const expected = req.portalActor?.csrfToken || "";
  if (!supplied || !expected || !constantTimeEqual(supplied, expected)) {
    return res.status(403).send(new ServerResponse(false, null, "Invalid client portal CSRF token"));
  }
  next();
}

export function requireClientCommentAccess(
  req: ClientPortalRequest,
  res: Response,
  next: NextFunction,
): void | Response {
  if (req.portalActor?.accessLevel !== "comment" && req.portalActor?.role !== "admin") {
    return res.status(403).send(new ServerResponse(false, null, "Comment access is not enabled"));
  }
  next();
}
