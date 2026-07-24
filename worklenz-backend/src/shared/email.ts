import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { createHash } from "crypto";
import { Validator } from "jsonschema";
import { QueryResult } from "pg";
import { Resend } from "resend";
import { log_error, isValidateEmail } from "./utils";
import emailRequestSchema from "../json_schemas/email-request-schema";
import db from "../config/db";

const sesCredentials =
  process.env.SES_ACCESS_KEY_ID && process.env.SES_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.SES_ACCESS_KEY_ID,
        secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
      }
    : undefined;

const sesClient = new SESClient({
  region: process.env.SES_REGION || process.env.AWS_REGION,
  credentials: sesCredentials,
});

export type EmailProvider = "ses" | "resend";

export function getEmailProvider(): EmailProvider {
  return process.env.EMAIL_PROVIDER === "resend" ? "resend" : "ses";
}

export interface IEmail {
  to?: string[];
  subject: string;
  html: string;
  from?: string;
  idempotencyKey?: string;
}

export interface IEmailResult {
  success: boolean;
  messageId?: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export class EmailRequest implements IEmail {
  public readonly html: string;
  public readonly subject: string;
  public readonly to: string[];

  constructor(toEmails: string[], subject: string, content: string) {
    this.to = toEmails;
    this.subject = subject;
    this.html = content;
  }
}

function isValidMailBody(body: IEmail) {
  const validator = new Validator();
  return validator.validate(body, emailRequestSchema).valid;
}

async function removeMails(query: string, emails: string[]) {
  const result: QueryResult<{ email: string }> = await db.query(query, []);
  const bouncedEmails = result.rows.map((e) => e.email);
  for (let i = emails.length - 1; i >= 0; i--) {
    const email = emails[i];
    if (bouncedEmails.includes(email)) {
      emails.splice(i, 1);
    }
  }
}

async function logEmailAttempt(
  email: string,
  subject: string,
  html: string,
  provider: EmailProvider,
): Promise<string | null> {
  try {
    const q = `
      INSERT INTO email_logs (email, subject, html, status, provider)
      VALUES ($1, $2, $3, 'pending', $4)
      RETURNING id;
    `;
    const result = await db.query(q, [email, subject, html, provider]);
    return result.rows[0]?.id || null;
  } catch (error) {
    log_error(error);
    return null;
  }
}

async function updateEmailLogStatus(
  logId: string,
  status: "sent" | "failed",
  messageId?: string,
  errorDetails?: string,
): Promise<void> {
  try {
    const q = `
      UPDATE email_logs
      SET status = $2, message_id = $3, error_details = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1;
    `;
    await db.query(q, [logId, status, messageId, errorDetails]);
  } catch (error) {
    log_error(error);
  }
}

function categorizeError(error: any): {
  code: string;
  message: string;
  details?: any;
} {
  if (error.name === "MessageRejected") {
    return {
      code: "MESSAGE_REJECTED",
      message: "Email rejected by Amazon SES",
      details: error.message,
    };
  }

  if (error.name === "SendingQuotaExceeded") {
    return {
      code: "QUOTA_EXCEEDED",
      message: "Daily sending quota exceeded",
      details: error.message,
    };
  }

  if (error.name === "Throttling") {
    return {
      code: "RATE_LIMITED",
      message: "Sending rate exceeded",
      details: error.message,
    };
  }

  if (error.code === "InvalidParameterValue") {
    return {
      code: "INVALID_EMAIL",
      message: "Invalid email address or parameters",
      details: error.message,
    };
  }

  if (error.code === "NetworkingError") {
    return {
      code: "NETWORK_ERROR",
      message: "Network connection failed",
      details: error.message,
    };
  }

  if (error.name === "rate_limit_exceeded" || error.statusCode === 429) {
    return {
      code: "RATE_LIMITED",
      message: "Email provider rate limit exceeded",
      details: error.message,
    };
  }

  if (
    error.name === "validation_error" ||
    error.name === "invalid_from_address" ||
    error.statusCode === 422
  ) {
    return {
      code: "INVALID_EMAIL",
      message: "Email provider rejected the message parameters",
      details: error.message,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: error.message || "Unknown error occurred",
    details: error,
  };
}

async function filterSpamEmails(emails: string[]): Promise<void> {
  await removeMails("SELECT email FROM spam_emails ORDER BY email;", emails);
}

async function filterBouncedEmails(emails: string[]): Promise<void> {
  await removeMails("SELECT email FROM bounced_emails ORDER BY email;", emails);
}

async function filterDeletedAccountEmails(emails: string[]): Promise<void> {
  await removeMails(
    "SELECT email FROM users WHERE is_deleted IS TRUE ORDER BY email;",
    emails,
  );
}

export async function sendEmail(email: IEmail): Promise<string | null> {
  const result = await sendEmailEnhanced(email);
  return result.success ? result.messageId || null : null;
}

export async function sendEmailEnhanced(email: IEmail): Promise<IEmailResult> {
  const attempts: Array<{ recipient: string; logId: string }> = [];
  const sentLogIds = new Set<string>();
  const provider = getEmailProvider();

  try {
    const options = { ...email } as IEmail;
    options.to = Array.isArray(options.to)
      ? Array.from(new Set(options.to))
      : [];

    // Filter out empty, null, undefined, and invalid emails
    options.to = options.to
      .filter(
        (email) =>
          email && typeof email === "string" && email.trim().length > 0,
      )
      .map((email) => email.trim())
      .filter((email) => isValidateEmail(email));

    if (options.to.length) {
      await filterBouncedEmails(options.to);
      await filterSpamEmails(options.to);
      await filterDeletedAccountEmails(options.to);
    }

    // Double-check that we still have valid emails after filtering
    if (!options.to.length) {
      return {
        success: false,
        error: {
          code: "NO_VALID_RECIPIENTS",
          message: "No valid email addresses after filtering",
        },
      };
    }

    if (!isValidMailBody(options)) {
      return {
        success: false,
        error: {
          code: "INVALID_EMAIL_BODY",
          message: "Email body validation failed",
        },
      };
    }

    // Log email attempt for each recipient
    for (const recipient of options.to) {
      const logId = await logEmailAttempt(
        recipient,
        options.subject,
        options.html,
        provider,
      );
      if (logId) {
        attempts.push({ recipient, logId });
      }
    }

    if (attempts.length !== options.to.length) {
      throw new Error("Unable to create delivery logs for every recipient");
    }

    // Generate plain text version by stripping HTML tags
    const plainText = options.html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (provider === "resend") {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
      }

      console.log(`Sending email via Resend to ${attempts.length} recipient(s).`);
      const resend = new Resend(apiKey);
      const messageIds: string[] = [];

      for (const attempt of attempts) {
        try {
          const recipientKey = createHash("sha256")
            .update(attempt.recipient.toLowerCase())
            .digest("hex")
            .slice(0, 16);
          const result = await resend.emails.send(
            {
              from:
                options.from ||
                process.env.EMAIL_FROM ||
                "Worklenz <noreply@localhost>",
              to: [attempt.recipient],
              subject: options.subject,
              html: options.html,
              text: plainText,
            },
            {
              idempotencyKey: options.idempotencyKey
                ? `worklenz/${options.idempotencyKey}/${recipientKey}`
                : `worklenz/${attempt.logId}`,
            },
          );

          if (result.error || !result.data?.id) {
            throw result.error || new Error("Resend did not return a message ID");
          }

          messageIds.push(result.data.id);
          await updateEmailLogStatus(attempt.logId, "sent", result.data.id);
          sentLogIds.add(attempt.logId);
        } catch (error) {
          const categorizedError = categorizeError(error);
          await updateEmailLogStatus(
            attempt.logId,
            "failed",
            undefined,
            JSON.stringify(categorizedError),
          );
          throw error;
        }
      }

      console.log("Email accepted by Resend.");
      return {
        success: true,
        messageId: messageIds[0],
      };
    }

    console.log(`Sending email via SES to ${options.to.length} recipient(s).`);
    const charset = "UTF-8";
    const command = new SendEmailCommand({
      Destination: {
        ToAddresses: options.to,
      },
      Message: {
        Subject: {
          Charset: charset,
          Data: options.subject,
        },
        Body: {
          Html: {
            Charset: charset,
            Data: options.html,
          },
          Text: {
            Charset: charset,
            Data: plainText,
          },
        },
      },
      Source:
        options.from ||
        process.env.EMAIL_FROM ||
        "Worklenz <noreply@localhost>",
    });

    const result = await sesClient.send(command);
    const messageId = result.MessageId;
    console.log("Email accepted by SES.");

    for (let i = 0; i < attempts.length; i++) {
      const uniqueMessageId =
        attempts.length > 1 ? `${messageId}-${i}` : messageId;
      await updateEmailLogStatus(
        attempts[i].logId,
        "sent",
        uniqueMessageId,
      );
      sentLogIds.add(attempts[i].logId);
    }

    return {
      success: true,
      messageId,
    };
  } catch (e) {
    log_error(e);
    const categorizedError = categorizeError(e);

    // Update log status to failed
    for (const { logId } of attempts) {
      if (sentLogIds.has(logId)) continue;
      await updateEmailLogStatus(
        logId,
        "failed",
        undefined,
        JSON.stringify(categorizedError),
      );
    }

    return {
      success: false,
      error: categorizedError,
    };
  }
}
