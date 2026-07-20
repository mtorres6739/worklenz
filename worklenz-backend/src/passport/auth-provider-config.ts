const enabled = (name: string): boolean =>
  process.env[name]?.trim().toLowerCase() === "true";

const configured = (...names: string[]): boolean =>
  names.every((name) => Boolean(process.env[name]?.trim()));

export const isGoogleWebLoginConfigured = (): boolean =>
  enabled("ENABLE_GOOGLE_LOGIN") &&
  configured("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL");

export const isGoogleMobileLoginConfigured = (): boolean =>
  enabled("ENABLE_GOOGLE_LOGIN") &&
  [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
  ].some((value) => Boolean(value?.trim()));

export const isAppleWebLoginConfigured = (): boolean =>
  enabled("ENABLE_APPLE_LOGIN") &&
  configured(
    "APPLE_CLIENT_ID",
    "APPLE_TEAM_ID",
    "APPLE_KEY_ID",
    "APPLE_PRIVATE_KEY_PATH",
    "APPLE_CALLBACK_URL",
  );

export const isAppleMobileLoginConfigured = (): boolean =>
  enabled("ENABLE_APPLE_LOGIN") &&
  [
    process.env.APPLE_CLIENT_ID,
    process.env.APPLE_IOS_CLIENT_ID,
    process.env.APPLE_ANDROID_CLIENT_ID,
  ].some((value) => Boolean(value?.trim()));
