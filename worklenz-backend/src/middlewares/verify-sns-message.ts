import { NextFunction, Request, Response } from "express";
import MessageValidator = require("sns-validator");

const validator = new MessageValidator();

export default function verifySnsMessage(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (process.env.SES_WEBHOOKS_ENABLED !== "true") {
    return res.status(404).end();
  }

  const expectedTopic = process.env.SES_SNS_TOPIC_ARN;
  if (!expectedTopic || req.body?.TopicArn !== expectedTopic) {
    return res.status(403).json({ done: false, message: "Invalid SNS topic." });
  }

  validator.validate(req.body, async (error) => {
    if (error) {
      return res
        .status(403)
        .json({ done: false, message: "Invalid SNS signature." });
    }

    if (req.body?.Type === "SubscriptionConfirmation") {
      try {
        const confirmationUrl = new URL(req.body.SubscribeURL);
        const region = process.env.SES_REGION;
        if (
          !region ||
          confirmationUrl.protocol !== "https:" ||
          confirmationUrl.hostname !== `sns.${region}.amazonaws.com` ||
          confirmationUrl.searchParams.get("Action") !== "ConfirmSubscription"
        ) {
          return res.status(403).json({ done: false, message: "Invalid SNS confirmation URL." });
        }
        const confirmation = await fetch(confirmationUrl);
        return confirmation.ok ? res.status(200).end() : res.status(502).end();
      } catch {
        return res.status(400).json({ done: false, message: "Invalid SNS confirmation request." });
      }
    }

    if (req.body?.Type !== "Notification") {
      return res.status(400).json({
        done: false,
        message: "Unsupported SNS message type.",
      });
    }
    return next();
  });
}
