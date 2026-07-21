import { getSelfHostedCapabilities } from "../shared/self-hosted-capabilities";

describe("self-hosted capability profile", () => {
  const previousEnvironment = process.env;

  beforeEach(() => {
    process.env = { ...previousEnvironment };
  });

  afterAll(() => {
    process.env = previousEnvironment;
  });

  it("removes commercial quotas while failing unfinished server modules closed", () => {
    delete process.env.FEATURE_CLIENT_PORTAL;
    delete process.env.FEATURE_SLACK;
    const profile = getSelfHostedCapabilities();
    expect(profile.profile).toBe("self_hosted_full");
    expect(profile.limits).toMatchObject({
      activeProjects: null,
      teamMembers: null,
      customFields: null,
      historyDays: null,
      storageBytes: null,
    });
    expect(profile.capabilities.schedule).toBe(true);
    expect(profile.capabilities.clientPortal).toBe(false);
    expect(profile.capabilities.slack).toBe(false);
  });

  it("enables only explicitly released server-backed modules", () => {
    process.env.FEATURE_PROJECT_FINANCE = "true";
    process.env.FEATURE_CLIENT_PORTAL = "false";
    process.env.FEATURE_OIDC = "true";
    process.env.FEATURE_SLACK = "true";
    const profile = getSelfHostedCapabilities();
    expect(profile.capabilities.projectFinance).toBe(true);
    expect(profile.capabilities.clientPortal).toBe(false);
    expect(profile.capabilities.oidc).toBe(true);
    expect(profile.capabilities.slack).toBe(true);
  });

  it("caps upload configuration at one GiB", () => {
    process.env.MAX_UPLOAD_BYTES = String(5 * 1024 * 1024 * 1024);
    expect(getSelfHostedCapabilities().limits.uploadBytes).toBe(
      1024 * 1024 * 1024,
    );
  });

  it("fails closed for an unknown capability profile", () => {
    process.env.FEATURE_PROFILE = "hosted_business";
    expect(() => getSelfHostedCapabilities()).toThrow(
      "Unsupported FEATURE_PROFILE",
    );
  });
});
