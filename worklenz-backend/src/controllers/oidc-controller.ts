import { IWorkLenzRequest } from "../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../interfaces/worklenz-response";
import { ServerResponse } from "../models/server-response";
import { OidcService } from "../services/oidc.service";
import { Request, Response } from "express";
import { getPublicBranding } from "../services/branding.service";

export default class OidcController {
  static async publicProvider(_req: Request, res: Response) {
    return res.status(200).send({
      oidc: await OidcService.getPublicProvider(),
      branding: await getPublicBranding(),
    });
  }

  static async authorize(req: Request, res: Response) {
    try {
      const url = await OidcService.authorizationUrl(req);
      req.session.save((error) => {
        if (error) return res.redirect("/auth/login?error=oidc_session");
        return res.redirect(url);
      });
    } catch {
      return res.redirect("/auth/login?error=oidc_unavailable");
    }
  }

  static async callback(req: Request, res: Response) {
    try {
      const user = await OidcService.complete(req);
      req.logIn(user, (error) => {
        if (error) return res.redirect("/auth/login?error=oidc_session");
        return res.redirect(process.env.LOGIN_SUCCESS_REDIRECT || "/auth/authenticating");
      });
    } catch {
      return res.redirect("/auth/login?error=oidc_login");
    }
  }

  static async getConfig(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    return res.status(200).send(new ServerResponse(true, await OidcService.getConfiguration(req.user?.owner_id as string)));
  }

  static async saveConfig(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    const body = req.body || {};
    if (!body.displayName || !body.issuer || !body.clientId) {
      return res.status(400).send(new ServerResponse(false, null, "displayName, issuer, and clientId are required"));
    }
    const config = await OidcService.saveConfiguration(
      req.user?.owner_id as string,
      req.user?.id as string,
      body,
    );
    return res.status(200).send(new ServerResponse(true, config));
  }

  static async test(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    return res.status(200).send(new ServerResponse(true, await OidcService.testConfiguration(req.user?.owner_id as string)));
  }
}
