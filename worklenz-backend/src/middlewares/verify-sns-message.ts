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

  if (req.body?.Type !== "Notification") {
    return res.status(400).json({
      done: false,
      message: "Only confirmed SNS notification deliveries are accepted.",
    });
  }

  validator.validate(req.body, (error) => {
    if (error) {
      return res
        .status(403)
        .json({ done: false, message: "Invalid SNS signature." });
    }
    return next();
  });
}
