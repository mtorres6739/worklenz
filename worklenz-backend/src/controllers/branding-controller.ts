import { IWorkLenzRequest } from "../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../interfaces/worklenz-response";
import db from "../config/db";
import { ServerResponse } from "../models/server-response";
import {
  createPresignedViewUrl,
  deleteObject,
  getOrganizationFaviconKey,
  getOrganizationLogoKey,
  uploadBuffer,
} from "../shared/storage";
import { recordIntegrationAudit } from "../services/integration-audit.service";
import { getBrandingForOwner } from "../services/branding.service";
import { isValidateEmail } from "../shared/utils";

const IMAGE_TYPES: Record<string, { extension: string; magic: (buffer: Buffer) => boolean }> = {
  "image/png": { extension: "png", magic: buffer => buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) },
  "image/jpeg": { extension: "jpg", magic: buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  "image/webp": { extension: "webp", magic: buffer => buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP" },
  "image/x-icon": { extension: "ico", magic: buffer => buffer.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])) },
};

function parseImage(data: unknown, maxBytes: number, allowed: string[]) {
  if (typeof data !== "string") throw new Error("Image must be a base64 data URL");
  const match = /^data:(image\/(?:png|jpeg|webp|x-icon));base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!match || !allowed.includes(match[1])) throw new Error("Unsupported image format");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > maxBytes) throw new Error("Image exceeds the allowed size");
  const type = IMAGE_TYPES[match[1]];
  if (!type?.magic(buffer)) throw new Error("Image content does not match its declared type");
  return { buffer, mime: match[1], extension: type.extension };
}

function allowedEmailFromDomains() {
  const configured = String(process.env.ALLOWED_EMAIL_FROM_DOMAINS || "")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  const defaultAddress = String(process.env.EMAIL_FROM || "").match(/<?([^<>\s]+@[^<>\s]+)>?\s*$/)?.[1];
  if (defaultAddress) configured.push(defaultAddress.split("@")[1].toLowerCase());
  return new Set(configured);
}

async function organizationForOwner(ownerId: string) {
  const result = await db.query("SELECT id, logo_url FROM organizations WHERE user_id = $1::UUID;", [ownerId]);
  if (!result.rows[0]) throw new Error("Organization not found");
  return result.rows[0];
}

async function signedAsset(key?: string | null) {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  return createPresignedViewUrl(key, key.split("/").pop() || "asset", 900);
}

export default class BrandingController {
  static async get(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    return res.status(200).send(new ServerResponse(true, await getBrandingForOwner(req.user?.owner_id as string)));
  }

  static async update(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    const body = req.body || {};
    const accent = String(body.accentColor || "#1677ff");
    const title = String(body.pageTitle || "SDM Projects").trim();
    const emailFromAddress = body.emailFromAddress
      ? String(body.emailFromAddress).trim().toLowerCase().slice(0, 255)
      : null;
    if (!/^#[0-9a-f]{6}$/i.test(accent) || title.length < 1 || title.length > 80) {
      return res.status(400).send(new ServerResponse(false, null, "Invalid accent color or page title"));
    }
    if (emailFromAddress && !isValidateEmail(emailFromAddress)) {
      return res.status(400).send(new ServerResponse(false, null, "Invalid email sender address"));
    }
    if (emailFromAddress && !allowedEmailFromDomains().has(emailFromAddress.split("@")[1])) {
      return res.status(400).send(new ServerResponse(false, null, "Email sender domain is not approved for this deployment"));
    }
    const result = await db.query(
      `INSERT INTO organization_branding
        (organization_id, display_name, accent_color, page_title, email_from_name,
         email_from_address, portal_appearance, invoice_appearance, updated_by)
       SELECT id, $2, $3, $4, $5, $6, $7::JSONB, $8::JSONB, $9::UUID
         FROM organizations WHERE user_id = $1::UUID
       ON CONFLICT (organization_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         accent_color = EXCLUDED.accent_color,
         page_title = EXCLUDED.page_title,
         email_from_name = EXCLUDED.email_from_name,
         email_from_address = EXCLUDED.email_from_address,
         portal_appearance = EXCLUDED.portal_appearance,
         invoice_appearance = EXCLUDED.invoice_appearance,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *;`,
      [
        req.user?.owner_id,
        body.displayName ? String(body.displayName).trim().slice(0, 80) : null,
        accent,
        title,
        body.emailFromName ? String(body.emailFromName).trim().slice(0, 80) : null,
        emailFromAddress,
        JSON.stringify(body.portalAppearance || {}),
        JSON.stringify(body.invoiceAppearance || {}),
        req.user?.id,
      ],
    );
    if (!result.rows[0]) throw new Error("Organization not found");
    await recordIntegrationAudit({ organizationId: result.rows[0].organization_id, userId: req.user?.id, integration: "branding", action: "settings_updated" });
    return res.status(200).send(new ServerResponse(true, await getBrandingForOwner(req.user?.owner_id as string)));
  }

  static async uploadLogo(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    const image = parseImage(req.body?.logoData, 5 * 1024 * 1024, ["image/png", "image/jpeg", "image/webp"]);
    const organization = await organizationForOwner(req.user?.owner_id as string);
    const key = getOrganizationLogoKey(organization.id, image.extension);
    if (!(await uploadBuffer(image.buffer, image.mime, key))) throw new Error("Logo upload failed");
    if (organization.logo_url && !/^https?:\/\//i.test(organization.logo_url) && organization.logo_url !== key) await deleteObject(organization.logo_url);
    await db.query("UPDATE organizations SET logo_url = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::UUID;", [organization.id, key]);
    await recordIntegrationAudit({ organizationId: organization.id, userId: req.user?.id, integration: "branding", action: "logo_uploaded" });
    return res.status(200).send(new ServerResponse(true, { logo_url: await signedAsset(key) }));
  }

  static async deleteLogo(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    const organization = await organizationForOwner(req.user?.owner_id as string);
    if (organization.logo_url && !/^https?:\/\//i.test(organization.logo_url)) await deleteObject(organization.logo_url);
    await db.query("UPDATE organizations SET logo_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1::UUID;", [organization.id]);
    await recordIntegrationAudit({ organizationId: organization.id, userId: req.user?.id, integration: "branding", action: "logo_deleted" });
    return res.status(200).send(new ServerResponse(true, { logo_url: null }));
  }

  static async uploadFavicon(req: IWorkLenzRequest, res: IWorkLenzResponse) {
    const image = parseImage(req.body?.faviconData, 512 * 1024, ["image/png", "image/x-icon"]);
    const organization = await organizationForOwner(req.user?.owner_id as string);
    const existing = await db.query("SELECT favicon_key FROM organization_branding WHERE organization_id = $1::UUID;", [organization.id]);
    const key = getOrganizationFaviconKey(organization.id, image.extension);
    if (!(await uploadBuffer(image.buffer, image.mime, key))) throw new Error("Favicon upload failed");
    const oldKey = existing.rows[0]?.favicon_key;
    if (oldKey && oldKey !== key) await deleteObject(oldKey);
    await db.query(
      `INSERT INTO organization_branding (organization_id, favicon_key, updated_by)
       VALUES ($1::UUID, $2, $3::UUID)
       ON CONFLICT (organization_id) DO UPDATE SET favicon_key = EXCLUDED.favicon_key, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP;`,
      [organization.id, key, req.user?.id],
    );
    await recordIntegrationAudit({ organizationId: organization.id, userId: req.user?.id, integration: "branding", action: "favicon_uploaded" });
    return res.status(200).send(new ServerResponse(true, { favicon_url: await signedAsset(key) }));
  }
}
