import db from "../config/db";

export interface IntegrationAuditEvent {
  organizationId?: string | null;
  userId?: string | null;
  integration: "oidc" | "slack" | "branding";
  action: string;
  success?: boolean;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordIntegrationAudit(event: IntegrationAuditEvent) {
  await db.query(
    `INSERT INTO integration_audit_log
      (organization_id, user_id, integration, action, success, details, ip_address, user_agent)
     VALUES ($1::UUID, $2::UUID, $3, $4, $5, $6::JSONB, $7::INET, $8);`,
    [
      event.organizationId || null,
      event.userId || null,
      event.integration,
      event.action,
      event.success !== false,
      JSON.stringify(event.details || {}),
      event.ipAddress || null,
      event.userAgent || null,
    ],
  );
}
