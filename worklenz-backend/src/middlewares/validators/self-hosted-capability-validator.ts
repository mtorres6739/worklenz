import { NextFunction } from "express";
import { IWorkLenzRequest } from "../../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../../interfaces/worklenz-response";
import { ServerResponse } from "../../models/server-response";
import {
  getSelfHostedCapabilities,
  SelfHostedCapabilityKey,
} from "../../shared/self-hosted-capabilities";

export function requireSelfHostedCapability(
  capability: SelfHostedCapabilityKey,
) {
  return (
    _req: IWorkLenzRequest,
    res: IWorkLenzResponse,
    next: NextFunction,
  ) => {
    if (getSelfHostedCapabilities().capabilities[capability]) return next();
    return res
      .status(404)
      .send(new ServerResponse(false, null, "Capability is not released"));
  };
}
