type Policies = Record<string, string[]>;

const isProduction = process.env.NODE_ENV === "production";
const appOrigin = process.env.APP_ORIGIN?.replace(/\/$/, "");
const appWebSocketOrigin = appOrigin?.replace(/^http/, "ws");

const policies: Policies = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "font-src": ["'self'", "data:"],
  "img-src": ["'self'", "data:", "blob:"],
  "media-src": ["'self'", "blob:"],
  "worker-src": ["'self'", "blob:"],
  "connect-src": ["'self'"],
  "frame-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"]
};

if (appOrigin) {
  policies["connect-src"].push(appOrigin);
}

if (appWebSocketOrigin) {
  policies["connect-src"].push(appWebSocketOrigin);
}

if (!isProduction) {
  policies["script-src"].push("'unsafe-eval'", "'unsafe-inline'");
  policies["connect-src"].push(
    "http://localhost:*",
    "https://localhost:*",
    "ws://localhost:*",
    "wss://localhost:*"
  );
}

export const CSP_POLICIES = Object.entries(policies)
  .map(([directive, values]) => `${directive} ${values.join(" ")}`)
  .join("; ");
