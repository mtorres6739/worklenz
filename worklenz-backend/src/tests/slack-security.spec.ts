import crypto from "crypto";
import { SlackIntegrationService } from "../services/slack-integration.service";

describe("Slack request signature verification", () => {
  const previousEnvironment = process.env;

  beforeEach(() => {
    process.env = {
      ...previousEnvironment,
      FEATURE_PROFILE: "self_hosted_full",
      FEATURE_SLACK: "true",
      SLACK_SIGNING_SECRET: "test-signing-secret",
    };
  });

  afterAll(() => {
    process.env = previousEnvironment;
  });

  function sign(timestamp: string, body: Buffer) {
    return `v0=${crypto
      .createHmac("sha256", process.env.SLACK_SIGNING_SECRET as string)
      .update(`v0:${timestamp}:${body.toString("utf8")}`)
      .digest("hex")}`;
  }

  it("accepts a current request with an exact body signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = Buffer.from("team_id=T123&text=SDM+Review+homepage");
    expect(SlackIntegrationService.verifySignature(timestamp, sign(timestamp, body), body)).toBe(true);
  });

  it("rejects a modified body", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = Buffer.from("team_id=T123&text=original");
    expect(
      SlackIntegrationService.verifySignature(
        timestamp,
        sign(timestamp, body),
        Buffer.from("team_id=T123&text=modified"),
      ),
    ).toBe(false);
  });

  it("rejects stale requests and requests while the capability is disabled", () => {
    const stale = String(Math.floor(Date.now() / 1000) - 301);
    const body = Buffer.from("team_id=T123");
    expect(SlackIntegrationService.verifySignature(stale, sign(stale, body), body)).toBe(false);
    process.env.FEATURE_SLACK = "false";
    const current = String(Math.floor(Date.now() / 1000));
    expect(SlackIntegrationService.verifySignature(current, sign(current, body), body)).toBe(false);
  });
});
