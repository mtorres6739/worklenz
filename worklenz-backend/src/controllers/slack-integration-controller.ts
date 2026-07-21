import { Request, Response } from "express";
import { IWorkLenzRequest } from "../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../interfaces/worklenz-response";
import { ServerResponse } from "../models/server-response";
import { SlackIntegrationService } from "../services/slack-integration.service";

export default class SlackIntegrationController {
  static async status(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    return res.status(200).send(await SlackIntegrationService.getStatus(req.user?.owner_id as string));
  }
  static async installUrl(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    return res.status(200).send({ url: await SlackIntegrationService.getInstallUrl(req, req.user?.owner_id as string, req.user?.id as string) });
  }
  static async callback(req: Request, res: Response) {
    try {
      await SlackIntegrationService.completeOAuth(req);
      return res.redirect("/worklenz/settings/integrations?slack=success");
    } catch {
      return res.redirect("/worklenz/settings/integrations?slack=error");
    }
  }
  static async disconnect(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    await SlackIntegrationService.disconnect(req.user?.owner_id as string, req.user?.id as string);
    return res.status(200).send(new ServerResponse(true, null));
  }
  static async channels(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    return res.status(200).send(await SlackIntegrationService.getChannels(req.user?.owner_id as string));
  }
  static async refreshChannels(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    return res.status(200).send(new ServerResponse(true, await SlackIntegrationService.getChannels(req.user?.owner_id as string, true)));
  }
  static async configs(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    return res.status(200).send(await SlackIntegrationService.getConfigs(req.user?.owner_id as string, req.params.projectId));
  }
  static async organizationConfigs(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    return res.status(200).send(new ServerResponse(true, await SlackIntegrationService.getConfigs(req.user?.owner_id as string)));
  }
  static async projectConfigs(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    return res.status(200).send(new ServerResponse(true, await SlackIntegrationService.getConfigs(req.user?.owner_id as string, req.params.projectId)));
  }
  static async createConfig(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    return res.status(200).send(new ServerResponse(true, await SlackIntegrationService.createConfig(req.user?.owner_id as string, req.user?.id as string, req.body)));
  }
  static async updateConfig(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    await SlackIntegrationService.updateConfig(req.user?.owner_id as string, req.user?.id as string, req.params.id, req.body.isActive === true);
    return res.status(200).send(new ServerResponse(true, null));
  }
  static async reactivateConfig(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    await SlackIntegrationService.updateConfig(req.user?.owner_id as string, req.user?.id as string, req.params.id, true);
    return res.status(200).send(new ServerResponse(true, null));
  }
  static async deleteConfig(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    await SlackIntegrationService.deleteConfig(req.user?.owner_id as string, req.user?.id as string, req.params.id);
    return res.status(200).send(new ServerResponse(true, null));
  }
  static async test(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    await SlackIntegrationService.sendTest(req.user?.owner_id as string, req.params.id);
    return res.status(200).send(new ServerResponse(true, null));
  }
  static async event(req: Request, res: Response) {
    const raw = req.body as Buffer;
    if (!SlackIntegrationService.verifySignature(req.get("x-slack-request-timestamp") || "", req.get("x-slack-signature") || "", raw)) {
      return res.status(401).send("invalid signature");
    }
    return res.status(200).send(await SlackIntegrationService.handleEvent(JSON.parse(raw.toString("utf8"))));
  }
  static async command(req: Request, res: Response) {
    const raw = req.body as Buffer;
    if (!SlackIntegrationService.verifySignature(req.get("x-slack-request-timestamp") || "", req.get("x-slack-signature") || "", raw)) {
      return res.status(401).send("invalid signature");
    }
    const form = new URLSearchParams(raw.toString("utf8"));
    return res.status(200).type("text/plain").send(await SlackIntegrationService.handleTaskCommand(form));
  }
}
