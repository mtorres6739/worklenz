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
    "SES_ACCESS_KEY_ID",
    "SES_REGION",
    "SES_SECRET_ACCESS_KEY",
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
}

global.Promise = require("bluebird");
SegfaultHandler.registerHandler("crash.log");
