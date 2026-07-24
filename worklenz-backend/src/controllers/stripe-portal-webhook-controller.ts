import { Request, Response } from "express";

import { handleStripeWebhook } from "../services/stripe-portal-payment.service";
import { getSelfHostedCapabilities } from "../shared/self-hosted-capabilities";
import { log_error } from "../shared/utils";

export default class StripePortalWebhookController {
  public static async handle(req: Request, res: Response): Promise<Response> {
    if (!getSelfHostedCapabilities().capabilities.stripeCheckout) {
      return res.status(404).end();
    }
    const signature = req.header("stripe-signature");
    if (!signature || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ done: false, message: "Invalid webhook request" });
    }
    try {
      await handleStripeWebhook(req.body, signature);
      return res.status(200).json({ received: true });
    } catch (error) {
      log_error(error);
      return res.status(400).json({ received: false });
    }
  }
}
