import crypto from "crypto";
import bcrypt from "bcrypt";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { Request } from "express";
import { generators, Issuer, TokenSet } from "openid-client";
import db from "../config/db";
import { EncryptionService } from "./encryption.service";
import { recordIntegrationAudit } from "./integration-audit.service";
import { getSelfHostedCapabilities } from "../shared/self-hosted-capabilities";

interface OidcProviderRecord {
  id: string;
  organization_id: string;
  display_name: string;
  issuer: string;
  client_id: string;
  client_secret_encrypted: string;
  scopes: string[];
  claim_mapping: Record<string, string>;
  enabled: boolean;
}

interface OidcFlowState {
  providerId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

const callbackUrl = () =>
  `${(process.env.APP_ORIGIN || process.env.FRONTEND_URL || "").replace(/\/+$/, "")}/secure/oidc/callback`;

function isPrivateOrReservedAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) {
    const [a, b, c] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  if (isIP(normalized) === 6) {
    if (normalized.startsWith("::ffff:")) {
      return isPrivateOrReservedAddress(normalized.slice("::ffff:".length));
    }
    return normalized === "::" || normalized === "::1" ||
      normalized.startsWith("fc") || normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:");
  }
  return true;
}

/**
 * OIDC discovery and token exchange are server-side HTTP requests. Reject
 * loopback/private/reserved targets by default so an admin form cannot become
 * an SSRF primitive. A deliberately private IdP requires the explicit host
 * setting OIDC_ALLOW_PRIVATE_ISSUER=true.
 */
export async function assertSafeOidcUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("OIDC endpoints must be credential-free HTTPS URLs");
  }
  if (process.env.OIDC_ALLOW_PRIVATE_ISSUER === "true") return url;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("OIDC endpoints must not target a local network host");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateOrReservedAddress(item.address))) {
    throw new Error("OIDC endpoints must resolve only to public addresses");
  }
  return url;
}

function requireOidcCapability() {
  if (!getSelfHostedCapabilities().capabilities.oidc) {
    throw new Error("OIDC capability is not released");
  }
}

async function discoverSafeIssuer(issuerUrl: string) {
  await assertSafeOidcUrl(issuerUrl);
  const issuer = await Issuer.discover(issuerUrl);
  const endpointKeys = ["authorization_endpoint", "token_endpoint", "userinfo_endpoint", "jwks_uri", "end_session_endpoint"] as const;
  for (const key of endpointKeys) {
    const endpoint = issuer.metadata[key];
    if (typeof endpoint === "string") await assertSafeOidcUrl(endpoint);
  }
  return issuer;
}

async function discoverClient(provider: OidcProviderRecord) {
  const issuer = await discoverSafeIssuer(provider.issuer);
  return new issuer.Client({
    client_id: provider.client_id,
    client_secret: EncryptionService.decrypt(provider.client_secret_encrypted),
    redirect_uris: [callbackUrl()],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_basic",
  });
}

async function getProvider(where: string, value: string): Promise<OidcProviderRecord | null> {
  const result = await db.query(
    `SELECT id, organization_id, display_name, issuer, client_id,
            client_secret_encrypted, scopes, claim_mapping, enabled
       FROM oidc_providers
      WHERE ${where} = $1
      LIMIT 1;`,
    [value],
  );
  return result.rows[0] || null;
}

export class OidcService {
  static async getPublicProvider() {
    if (!getSelfHostedCapabilities().capabilities.oidc) return null;
    const result = await db.query(
      `SELECT display_name
         FROM oidc_providers
        WHERE enabled IS TRUE
        ORDER BY created_at
        LIMIT 1;`,
    );
    return result.rows[0] || null;
  }

  static async getConfiguration(ownerId: string) {
    const result = await db.query(
      `SELECT p.id, p.display_name, p.issuer, p.client_id, p.scopes,
              p.claim_mapping, p.enabled, p.updated_at,
              (p.client_secret_encrypted IS NOT NULL) AS has_client_secret
         FROM oidc_providers p
         JOIN organizations o ON o.id = p.organization_id
        WHERE o.user_id = $1::UUID;`,
      [ownerId],
    );
    return result.rows[0] || null;
  }

  static async saveConfiguration(
    ownerId: string,
    userId: string,
    input: {
      displayName: string;
      issuer: string;
      clientId: string;
      clientSecret?: string;
      scopes?: string[];
      claimMapping?: Record<string, string>;
      enabled?: boolean;
    },
  ) {
    requireOidcCapability();
    const issuerUrl = await assertSafeOidcUrl(input.issuer);
    if (!input.clientSecret) {
      const existing = await this.getConfiguration(ownerId);
      if (!existing?.has_client_secret) throw new Error("OIDC client secret is required");
    }

    const secret = input.clientSecret
      ? EncryptionService.encrypt(input.clientSecret)
      : null;
    const scopes = Array.from(new Set(input.scopes || ["openid", "profile", "email"]));
    if (!scopes.includes("openid") || !scopes.includes("email")) {
      throw new Error("OIDC scopes must include openid and email");
    }
    const claimMapping = {
      email: String(input.claimMapping?.email || "email").trim(),
      name: String(input.claimMapping?.name || "name").trim(),
      subject: String(input.claimMapping?.subject || "sub").trim(),
    };
    if (Object.values(claimMapping).some(claim => !/^[A-Za-z0-9_.:-]{1,100}$/.test(claim))) {
      throw new Error("OIDC claim names contain unsupported characters");
    }
    if (input.enabled === true) {
      await discoverSafeIssuer(issuerUrl.toString().replace(/\/$/, ""));
    }

    const result = await db.query(
      `INSERT INTO oidc_providers
        (organization_id, display_name, issuer, client_id, client_secret_encrypted,
         scopes, claim_mapping, enabled, created_by)
       SELECT o.id, $2, $3, $4, $5, $6::TEXT[], $7::JSONB, $8, $9::UUID
         FROM organizations o
        WHERE o.user_id = $1::UUID
       ON CONFLICT (organization_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         issuer = EXCLUDED.issuer,
         client_id = EXCLUDED.client_id,
         client_secret_encrypted = COALESCE(EXCLUDED.client_secret_encrypted, oidc_providers.client_secret_encrypted),
         scopes = EXCLUDED.scopes,
         claim_mapping = EXCLUDED.claim_mapping,
         enabled = EXCLUDED.enabled,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, organization_id, display_name, issuer, client_id, scopes,
                 claim_mapping, enabled, updated_at;`,
      [
        ownerId,
        input.displayName.trim(),
        issuerUrl.toString().replace(/\/$/, ""),
        input.clientId.trim(),
        secret,
        scopes,
        JSON.stringify(claimMapping),
        input.enabled === true,
        userId,
      ],
    );
    if (!result.rows[0]) throw new Error("Organization not found");
    await recordIntegrationAudit({
      organizationId: result.rows[0].organization_id,
      userId,
      integration: "oidc",
      action: "configuration_updated",
      details: { issuer: result.rows[0].issuer, enabled: result.rows[0].enabled },
    });
    return { ...result.rows[0], has_client_secret: true };
  }

  static async testConfiguration(ownerId: string) {
    requireOidcCapability();
    const providerResult = await db.query(
      `SELECT p.* FROM oidc_providers p
       JOIN organizations o ON o.id = p.organization_id
       WHERE o.user_id = $1::UUID LIMIT 1;`,
      [ownerId],
    );
    const provider = providerResult.rows[0] as OidcProviderRecord | undefined;
    if (!provider) throw new Error("OIDC provider is not configured");
    const client = await discoverClient(provider);
    return {
      issuer: client.issuer.issuer,
      authorizationEndpoint: client.issuer.metadata.authorization_endpoint,
      tokenEndpoint: client.issuer.metadata.token_endpoint,
      callbackUrl: callbackUrl(),
    };
  }

  static async authorizationUrl(req: Request) {
    requireOidcCapability();
    const result = await db.query(
      `SELECT * FROM oidc_providers WHERE enabled IS TRUE ORDER BY created_at LIMIT 1;`,
    );
    const provider = result.rows[0] as OidcProviderRecord | undefined;
    if (!provider) throw new Error("OIDC provider is not enabled");
    const client = await discoverClient(provider);
    const codeVerifier = generators.codeVerifier();
    const flow: OidcFlowState = {
      providerId: provider.id,
      state: generators.state(),
      nonce: generators.nonce(),
      codeVerifier,
      createdAt: Date.now(),
    };
    (req.session as any).oidcFlow = flow;
    return client.authorizationUrl({
      scope: provider.scopes.join(" "),
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: generators.codeChallenge(codeVerifier),
      code_challenge_method: "S256",
    });
  }

  static async complete(req: Request) {
    requireOidcCapability();
    const flow = (req.session as any).oidcFlow as OidcFlowState | undefined;
    delete (req.session as any).oidcFlow;
    if (!flow || Date.now() - flow.createdAt > 10 * 60 * 1000) {
      throw new Error("OIDC login state is missing or expired");
    }
    const provider = await getProvider("id", flow.providerId);
    if (!provider?.enabled) throw new Error("OIDC provider is unavailable");
    const client = await discoverClient(provider);
    const params = client.callbackParams(req);
    const tokenSet: TokenSet = await client.callback(callbackUrl(), params, {
      state: flow.state,
      nonce: flow.nonce,
      code_verifier: flow.codeVerifier,
    });
    const claims = tokenSet.claims() as Record<string, any>;
    const mapping = provider.claim_mapping || {};
    const subject = String(claims[mapping.subject || "sub"] || "");
    const email = String(claims[mapping.email || "email"] || "").trim().toLowerCase();
    const name = String(claims[mapping.name || "name"] || email.split("@")[0]).trim();
    if (!subject || !email) throw new Error("OIDC response is missing subject or email");
    if (claims.email_verified === false) throw new Error("OIDC email is not verified");

    const transaction = await db.connect();
    let user: { id: string; email: string; name: string } | undefined;
    try {
      await transaction.query("BEGIN");
      // Serialize linking/provisioning for the same provider and email. This
      // prevents simultaneous callbacks from creating duplicate users or
      // consuming one invitation twice.
      await transaction.query("SELECT pg_advisory_xact_lock(hashtext($1));", [`${provider.id}:${email}`]);
      const identity = await transaction.query(
        `SELECT u.id, u.email, u.name
           FROM oidc_identities i JOIN users u ON u.id = i.user_id
          WHERE i.provider_id = $1::UUID AND i.subject = $2 AND u.is_deleted IS FALSE;`,
        [provider.id, subject],
      );
      user = identity.rows[0];

      if (!user) {
        const account = await transaction.query(
          `SELECT DISTINCT u.id, u.email, u.name
             FROM users u
             JOIN team_members tm ON tm.user_id = u.id
             JOIN teams t ON t.id = tm.team_id
             JOIN organizations o ON o.id = $2::UUID
            WHERE LOWER(u.email) = $1
              AND u.is_deleted IS FALSE
              AND (t.organization_id = o.id OR t.user_id = o.user_id)
            LIMIT 1;`,
          [email, provider.organization_id],
        );
        user = account.rows[0];
      }

      if (!user) {
        const invitation = await transaction.query(
          `SELECT ei.team_id, ei.team_member_id
             FROM email_invitations ei
             JOIN teams t ON t.id = ei.team_id
             JOIN organizations o ON o.id = $2::UUID
            WHERE LOWER(ei.email) = $1
              AND (t.organization_id = o.id OR t.user_id = o.user_id)
            ORDER BY ei.created_at DESC LIMIT 1
            FOR UPDATE OF ei;`,
          [email, provider.organization_id],
        );
        const invite = invitation.rows[0];
        if (!invite) throw new Error("This email has not been invited to this Worklenz organization");
        const password = bcrypt.hashSync(crypto.randomBytes(48).toString("base64url"), bcrypt.genSaltSync(12));
        const created = await transaction.query(
          `INSERT INTO users (name, email, password, timezone_id, active_team)
           VALUES ($1, $2, $3, (SELECT id FROM timezones WHERE name = 'UTC' LIMIT 1), $4::UUID)
           RETURNING id, email, name;`,
          [name.slice(0, 55), email, password, invite.team_id],
        );
        const createdUser = created.rows[0] as { id: string; email: string; name: string } | undefined;
        if (!createdUser) throw new Error("OIDC account provisioning failed");
        user = createdUser;
        if (invite.team_member_id) {
          await transaction.query(
            `UPDATE team_members SET user_id = $1::UUID
              WHERE id = $2::UUID AND team_id = $3::UUID;`,
            [createdUser.id, invite.team_member_id, invite.team_id],
          );
        }
        await transaction.query(
          `DELETE FROM email_invitations WHERE LOWER(email) = $1 AND team_id = $2::UUID;`,
          [email, invite.team_id],
        );
      }

      if (!user) throw new Error("OIDC account provisioning failed");
      await transaction.query(
        `INSERT INTO oidc_identities (provider_id, user_id, subject, email_at_link, last_login_at)
         VALUES ($1::UUID, $2::UUID, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (provider_id, user_id) DO UPDATE SET
           subject = EXCLUDED.subject,
           email_at_link = EXCLUDED.email_at_link,
           last_login_at = CURRENT_TIMESTAMP;`,
        [provider.id, user.id, subject, email],
      );
      await transaction.query("COMMIT");
    } catch (error) {
      await transaction.query("ROLLBACK");
      throw error;
    } finally {
      transaction.release();
    }
    if (!user) throw new Error("OIDC account provisioning failed");
    await recordIntegrationAudit({
      organizationId: provider.organization_id,
      userId: user.id,
      integration: "oidc",
      action: "login_succeeded",
      details: { providerId: provider.id },
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || null,
    });
    return user;
  }
}
