import {
  CLIENT_PORTAL_COOKIE,
  hashPortalToken,
  isStrongPortalPassword,
  normalizePortalEmail,
  portalTokenFromCookieHeader,
  portalTokenFromRequest,
  randomPortalToken,
  setPortalCookie,
} from "../services/client-portal-session.service";
import { requireClientPortalCsrf } from "../middlewares/client-portal-auth";

describe("client portal security primitives", () => {
  it("uses opaque 256-bit tokens and stores stable SHA-256 digests", () => {
    const token = randomPortalToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPortalToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPortalToken(token)).not.toBe(token);
    expect(hashPortalToken(token)).toBe(hashPortalToken(token));
  });

  it("accepts only the dedicated portal cookie, never an authorization header", () => {
    const token = "a".repeat(64);
    expect(portalTokenFromCookieHeader(`other=x; ${CLIENT_PORTAL_COOKIE}=${token}`)).toBe(token);
    expect(portalTokenFromCookieHeader(`connect.sid=${token}`)).toBeNull();
    expect(portalTokenFromCookieHeader(`${CLIENT_PORTAL_COOKIE}=short`)).toBeNull();
    expect(portalTokenFromCookieHeader(`${CLIENT_PORTAL_COOKIE}=%broken`)).toBeNull();
    expect(portalTokenFromRequest({ cookies: { [CLIENT_PORTAL_COOKIE]: token } } as any)).toBe(token);
    expect(portalTokenFromRequest({ cookies: {}, headers: { authorization: `Bearer ${token}` } } as any)).toBeNull();
  });

  it("sets a distinct HttpOnly Secure SameSite cookie in production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const cookie = jest.fn();
    setPortalCookie({ cookie } as any, "b".repeat(64));
    expect(cookie).toHaveBeenCalledWith(
      CLIENT_PORTAL_COOKIE,
      "b".repeat(64),
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: "lax", path: "/" }),
    );
    process.env.NODE_ENV = previous;
  });

  it("normalizes email and enforces the portal password policy", () => {
    expect(normalizePortalEmail("  Client@Example.COM ")).toBe("client@example.com");
    expect(isStrongPortalPassword("Strong-client-Password9!")).toBe(true);
    expect(isStrongPortalPassword("onlylowercase123!")).toBe(false);
    expect(isStrongPortalPassword("Short9!")).toBe(false);
  });

  it("requires the per-session CSRF token on portal mutations", () => {
    const next = jest.fn();
    const status = jest.fn().mockReturnThis();
    const send = jest.fn().mockReturnThis();
    const response = { status, send } as any;
    const actor = { csrfToken: "c".repeat(64) };

    requireClientPortalCsrf(
      { method: "POST", get: () => "bad-token", portalActor: actor } as any,
      response,
      next,
    );
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();

    status.mockClear();
    requireClientPortalCsrf(
      { method: "POST", get: () => "c".repeat(64), portalActor: actor } as any,
      response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });
});
