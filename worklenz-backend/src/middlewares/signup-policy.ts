import { NextFunction, Request, Response } from "express";
import { ServerResponse } from "../models/server-response";

export default function signupPolicy(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (process.env.ALLOW_SIGNUPS === "true") return next();

  const hasInvitation = Boolean(
    req.body?.team_id && req.body?.team_member_id,
  );

  if (hasInvitation) return next();

  return res
    .status(403)
    .send(
      new ServerResponse(
        false,
        null,
        "Public signup is disabled. Ask an administrator for an invitation.",
      ),
    );
}
