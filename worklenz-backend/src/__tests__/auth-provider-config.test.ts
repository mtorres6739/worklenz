import {
  isAppleMobileLoginConfigured,
  isAppleWebLoginConfigured,
  isGoogleMobileLoginConfigured,
  isGoogleWebLoginConfigured,
} from "../passport/auth-provider-config";

const providerEnvironmentVariables = [
  "ENABLE_GOOGLE_LOGIN",
  "ENABLE_APPLE_LOGIN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_CALLBACK_URL",
  "GOOGLE_ANDROID_CLIENT_ID",
  "GOOGLE_IOS_CLIENT_ID",
  "APPLE_CLIENT_ID",
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY_PATH",
  "APPLE_CALLBACK_URL",
  "APPLE_IOS_CLIENT_ID",
  "APPLE_ANDROID_CLIENT_ID",
];

const originalEnvironment = Object.fromEntries(
  providerEnvironmentVariables.map((name) => [name, process.env[name]]),
);

describe("authentication provider configuration", () => {
  beforeEach(() => {
    for (const name of providerEnvironmentVariables) delete process.env[name];
  });

  afterAll(() => {
    for (const name of providerEnvironmentVariables) {
      const originalValue = originalEnvironment[name];
      if (originalValue === undefined) delete process.env[name];
      else process.env[name] = originalValue;
    }
  });

  it("keeps all external providers disabled by default", () => {
    expect(isGoogleWebLoginConfigured()).toBe(false);
    expect(isGoogleMobileLoginConfigured()).toBe(false);
    expect(isAppleWebLoginConfigured()).toBe(false);
    expect(isAppleMobileLoginConfigured()).toBe(false);
  });

  it("does not construct the Google Passport strategy when it is disabled", () => {
    jest.resetModules();
    const strategy = require("../passport/passport-strategies/passport-google").default;
    expect(strategy).toBeNull();
  });

  it("requires both the backend feature flag and complete Google web credentials", () => {
    process.env.ENABLE_GOOGLE_LOGIN = "true";
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    expect(isGoogleWebLoginConfigured()).toBe(false);

    process.env.GOOGLE_CALLBACK_URL = "https://example.test/secure/google/verify";
    expect(isGoogleWebLoginConfigured()).toBe(true);
  });

  it("requires both the backend feature flag and complete Apple web credentials", () => {
    process.env.ENABLE_APPLE_LOGIN = "true";
    process.env.APPLE_CLIENT_ID = "client";
    process.env.APPLE_TEAM_ID = "team";
    process.env.APPLE_KEY_ID = "key";
    process.env.APPLE_PRIVATE_KEY_PATH = "/run/secrets/apple-key";
    expect(isAppleWebLoginConfigured()).toBe(false);

    process.env.APPLE_CALLBACK_URL = "https://example.test/secure/apple/verify";
    expect(isAppleWebLoginConfigured()).toBe(true);
  });
});
