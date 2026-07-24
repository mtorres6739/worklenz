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
    delete process.env.FEATURE_CLIENT_PORTAL_SERVICES;
    delete process.env.FEATURE_CLIENT_PORTAL_REQUESTS;
    delete process.env.FEATURE_CLIENT_PORTAL_REQUEST_NOTIFICATIONS;
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
    expect(profile.capabilities.clientPortalServices).toBe(false);
    expect(profile.capabilities.clientPortalRequests).toBe(false);
    expect(
      profile.capabilities.clientPortalRequestNotifications,
    ).toBe(false);
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

  it("exposes the client portal only when the collaboration wave is enabled", () => {
    process.env.FEATURE_CLIENT_PORTAL = "true";
    expect(getSelfHostedCapabilities().capabilities.clientPortal).toBe(true);
  });

  it("keeps portal services and requests behind their parent capabilities", () => {
    process.env.FEATURE_CLIENT_PORTAL = "false";
    process.env.FEATURE_CLIENT_PORTAL_SERVICES = "true";
    process.env.FEATURE_CLIENT_PORTAL_REQUESTS = "true";
    process.env.FEATURE_CLIENT_PORTAL_REQUEST_NOTIFICATIONS = "true";
    expect(getSelfHostedCapabilities().capabilities.clientPortalServices).toBe(
      false,
    );
    expect(getSelfHostedCapabilities().capabilities.clientPortalRequests).toBe(
      false,
    );
    expect(
      getSelfHostedCapabilities().capabilities
        .clientPortalRequestNotifications,
    ).toBe(false);

    process.env.FEATURE_CLIENT_PORTAL = "true";
    expect(getSelfHostedCapabilities().capabilities.clientPortalServices).toBe(
      true,
    );
    expect(getSelfHostedCapabilities().capabilities.clientPortalRequests).toBe(
      true,
    );
    expect(
      getSelfHostedCapabilities().capabilities
        .clientPortalRequestNotifications,
    ).toBe(true);

    process.env.FEATURE_CLIENT_PORTAL_SERVICES = "false";
    expect(getSelfHostedCapabilities().capabilities.clientPortalRequests).toBe(
      false,
    );
    expect(
      getSelfHostedCapabilities().capabilities
        .clientPortalRequestNotifications,
    ).toBe(false);
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
