import db from "../config/db";
import { createPresignedViewUrl } from "../shared/storage";

async function signedAsset(key?: string | null) {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  return createPresignedViewUrl(key, key.split("/").pop() || "asset", 900);
}

export async function getBrandingForOwner(ownerId: string) {
  const result = await db.query(
    `SELECT b.display_name, b.accent_color, b.page_title,
            b.email_from_name, b.email_from_address,
            b.portal_appearance, b.invoice_appearance,
            b.favicon_key, o.logo_url AS logo_key
       FROM organizations o
       LEFT JOIN organization_branding b ON b.organization_id = o.id
      WHERE o.user_id = $1::UUID;`,
    [ownerId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Organization not found");
  return {
    display_name: row.display_name || "SDM Projects",
    accent_color: row.accent_color || "#1677ff",
    page_title: row.page_title || "SDM Projects",
    email_from_name: row.email_from_name || null,
    email_from_address: row.email_from_address || null,
    portal_appearance: row.portal_appearance || {},
    invoice_appearance: row.invoice_appearance || {},
    logo_url: await signedAsset(row.logo_key),
    favicon_url: await signedAsset(row.favicon_key),
  };
}

export async function getPublicBranding() {
  const result = await db.query(
    `SELECT o.user_id
       FROM organizations o
      ORDER BY o.created_at, o.id
      LIMIT 1;`,
  );
  if (!result.rows[0]?.user_id) return {
    display_name: "SDM Projects",
    accent_color: "#1677ff",
    page_title: "SDM Projects",
    logo_url: null,
    favicon_url: null,
  };
  const branding = await getBrandingForOwner(result.rows[0].user_id);
  return {
    display_name: branding.display_name,
    accent_color: branding.accent_color,
    page_title: branding.page_title,
    logo_url: branding.logo_url,
    favicon_url: branding.favicon_url,
  };
}

export async function getEmailIdentityForTeam(teamId: string) {
  const result = await db.query(
    `SELECT b.email_from_name, b.email_from_address
       FROM teams t
       JOIN organizations o ON (t.organization_id = o.id OR t.user_id = o.user_id)
       LEFT JOIN organization_branding b ON b.organization_id = o.id
      WHERE t.id = $1::UUID LIMIT 1;`,
    [teamId],
  );
  const row = result.rows[0];
  if (!row?.email_from_address) return undefined;
  return row.email_from_name
    ? `${String(row.email_from_name).replace(/[<>\r\n]/g, "").trim()} <${row.email_from_address}>`
    : row.email_from_address;
}
