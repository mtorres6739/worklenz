import { Webhook } from "standardwebhooks";
import db from "../config/db";
import ResendWebhookController, {
  mapResendEventType,
} from "../controllers/resend-webhook-controller";
import { getEmailProvider } from "../shared/email";

jest.mock("../config/db", () => ({
  __esModule: true,
  default: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
  },
}));

describe("Resend email provider", () => {
  const previousEnvironment = process.env;
  const webhookSecret = `whsec_${Buffer.from(
    "worklenz-test-signing-secret",
  ).toString("base64")}`;

  beforeEach(() => {
    process.env = {
      ...previousEnvironment,
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test",
      RESEND_WEBHOOKS_ENABLED: "true",
      RESEND_WEBHOOK_SECRET: webhookSecret,
    };
  });

  afterAll(() => {
    process.env = previousEnvironment;
  });

  function signedRequest(event: object, signatureOverride?: string) {
    const body = JSON.stringify(event);
    const id = "msg_test_worklenz";
    const timestamp = new Date();
    const signature = new Webhook(webhookSecret).sign(id, timestamp, body);
    const headers: Record<string, string> = {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signatureOverride || signature,
    };

    return {
      body,
      header: (name: string) => headers[name.toLowerCase()],
    };
  }

  function response() {
    const res: any = {
      status: jest.fn(),
      json: jest.fn(),
      end: jest.fn(),
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    res.end.mockReturnValue(res);
    return res;
  }

  it("selects Resend explicitly and preserves SES as the default fallback", () => {
    expect(getEmailProvider()).toBe("resend");
    delete process.env.EMAIL_PROVIDER;
    expect(getEmailProvider()).toBe("ses");
  });

  it("maps delivery and suppression events to the existing status model", () => {
    expect(mapResendEventType("email.sent")).toBe("send");
    expect(mapResendEventType("email.delivered")).toBe("delivery");
    expect(mapResendEventType("email.bounced")).toBe("bounce");
    expect(mapResendEventType("email.complained")).toBe("complaint");
    expect(mapResendEventType("email.failed")).toBe("reject");
  });

  it("verifies the exact signed body and records a delivery event", async () => {
    const req = signedRequest({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: {
        created_at: new Date().toISOString(),
        email_id: "email_test_1",
        from: "Worklenz <noreply@notifications.myfusionadmin.com>",
        to: ["recipient@example.com"],
        subject: "Invitation",
      },
    });
    const res = response();

    await ResendWebhookController.handle(req as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO email_delivery_events"),
      expect.arrayContaining([
        "resend",
        "msg_test_worklenz",
        "email_test_1",
        "delivery",
        "recipient@example.com",
      ]),
    );
  });

  it("rejects a modified signature before writing delivery state", async () => {
    const req = signedRequest(
      {
        type: "email.delivered",
        created_at: new Date().toISOString(),
        data: {
          created_at: new Date().toISOString(),
          email_id: "email_test_2",
          from: "Worklenz <noreply@notifications.myfusionadmin.com>",
          to: ["recipient@example.com"],
          subject: "Invitation",
        },
      },
      "v1,invalid",
    );
    const res = response();

    await ResendWebhookController.handle(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.query).not.toHaveBeenCalled();
  });
});
