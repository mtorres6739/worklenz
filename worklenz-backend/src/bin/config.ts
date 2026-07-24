import dotenv from "dotenv";
import SegfaultHandler from "segfault-handler";

dotenv.config();

if (process.env.NODE_ENV === "production") {
  const required = [
    "APP_ORIGIN",
    "COOKIE_SECRET",
    "DB_HOST",
    "DB_NAME",
    "DB_PASSWORD",
    "DB_USER",
    "EMAIL_FROM",
    "ENCRYPTION_KEY",
    "ENCRYPTION_SALT",
    "JWT_SECRET",
    "S3_ACCESS_KEY_ID",
    "S3_BUCKET",
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_SECRET_ACCESS_KEY",
    "SESSION_NAME",
    "SESSION_SECRET",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
  if (process.env.ALLOW_SIGNUPS !== "false") {
    throw new Error("Production requires ALLOW_SIGNUPS=false unless the fork is intentionally reconfigured.");
  }
  const emailProvider = process.env.EMAIL_PROVIDER || "ses";
  if (emailProvider === "resend") {
    const resendRequired = ["RESEND_API_KEY"];
    if (process.env.RESEND_WEBHOOKS_ENABLED === "true") {
      resendRequired.push("RESEND_WEBHOOK_SECRET");
    }
    const missingResend = resendRequired.filter((name) => !process.env[name]);
    if (missingResend.length > 0) {
      throw new Error(`EMAIL_PROVIDER=resend requires: ${missingResend.join(", ")}`);
    }
  } else if (emailProvider === "ses") {
    const sesRequired = ["SES_ACCESS_KEY_ID", "SES_REGION", "SES_SECRET_ACCESS_KEY"];
    const missingSes = sesRequired.filter((name) => !process.env[name]);
    if (missingSes.length > 0) {
      throw new Error(`EMAIL_PROVIDER=ses requires: ${missingSes.join(", ")}`);
    }
  } else {
    throw new Error(`Unsupported EMAIL_PROVIDER: ${emailProvider}`);
  }
  if (process.env.FEATURE_SLACK === "true") {
    const slackRequired = ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"];
    const missingSlack = slackRequired.filter((name) => !process.env[name]);
    if (missingSlack.length > 0) {
      throw new Error(`FEATURE_SLACK requires: ${missingSlack.join(", ")}`);
    }
  }
}

global.Promise = require("bluebird");
SegfaultHandler.registerHandler("crash.log");
