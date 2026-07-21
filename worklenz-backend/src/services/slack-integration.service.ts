import crypto from "crypto";
import axios from "axios";
import { Request } from "express";
import db from "../config/db";
import { EncryptionService } from "./encryption.service";
import { recordIntegrationAudit } from "./integration-audit.service";
import { getSelfHostedCapabilities } from "../shared/self-hosted-capabilities";

const SLACK_API = "https://slack.com/api";
const OAUTH_SCOPES = ["channels:join", "channels:read", "chat:write", "commands", "groups:read", "users:read", "users:read.email"];

interface SlackWorkspace {
  id: string;
  organization_id: string;
  team_id: string;
  team_name: string;
  access_token_encrypted: string;
  bot_user_id?: string;
}

function capabilityEnabled() {
  return getSelfHostedCapabilities().capabilities.slack;
}

function requireConfiguration() {
  if (!capabilityEnabled()) throw new Error("Slack capability is not released");
  if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET || !process.env.SLACK_SIGNING_SECRET) {
    throw new Error("Slack OAuth is not configured");
  }
}

function callbackUrl() {
  return process.env.SLACK_CALLBACK_URL || `${(process.env.APP_ORIGIN || "").replace(/\/+$/, "")}/secure/slack/oauth/callback`;
}

async function organizationIdForOwner(ownerId: string) {
  const result = await db.query("SELECT id FROM organizations WHERE user_id = $1::UUID;", [ownerId]);
  if (!result.rows[0]) throw new Error("Organization not found");
  return result.rows[0].id as string;
}

async function workspaceForOrganization(organizationId: string): Promise<SlackWorkspace | null> {
  const result = await db.query(
    `SELECT * FROM slack_workspaces
      WHERE organization_id = $1::UUID AND is_active IS TRUE
      ORDER BY updated_at DESC LIMIT 1;`,
    [organizationId],
  );
  return result.rows[0] || null;
}

async function slackApi<T = any>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const response = await axios.post(`${SLACK_API}/${method}`, body || {}, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    timeout: 10000,
  });
  if (!response.data?.ok) throw new Error(`Slack ${method} failed: ${response.data?.error || "unknown_error"}`);
  return response.data as T;
}

async function syncChannels(workspace: SlackWorkspace) {
  const token = EncryptionService.decrypt(workspace.access_token_encrypted);
  const channels: any[] = [];
  let cursor = "";
  do {
    const data: any = await slackApi(token, "conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: false,
      limit: 200,
      cursor: cursor || undefined,
    });
    channels.push(...(data.channels || []));
    cursor = data.response_metadata?.next_cursor || "";
  } while (cursor && channels.length < 2000);

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const channel of channels) {
      await client.query(
        `INSERT INTO slack_channels
          (slack_workspace_id, channel_id, channel_name, is_private, is_archived)
         VALUES ($1::UUID, $2, $3, $4, $5)
         ON CONFLICT (slack_workspace_id, channel_id) DO UPDATE SET
           channel_name = EXCLUDED.channel_name,
           is_private = EXCLUDED.is_private,
           is_archived = EXCLUDED.is_archived,
           updated_at = CURRENT_TIMESTAMP;`,
        [workspace.id, channel.id, channel.name, channel.is_private === true, channel.is_archived === true],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return channels.length;
}

export class SlackIntegrationService {
  static getAvailability() {
    return {
      available: capabilityEnabled() && Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET && process.env.SLACK_SIGNING_SECRET),
    };
  }

  static async getStatus(ownerId: string) {
    if (!capabilityEnabled()) return { connected: false };
    const orgId = await organizationIdForOwner(ownerId);
    const workspace = await workspaceForOrganization(orgId);
    return workspace
      ? { connected: true, workspace: { id: workspace.id, name: workspace.team_name, team_id: workspace.team_id, is_active: true } }
      : { connected: false };
  }

  static async getInstallUrl(req: Request, ownerId: string, userId: string) {
    requireConfiguration();
    const organizationId = await organizationIdForOwner(ownerId);
    const state = EncryptionService.generateToken(32);
    (req.session as any).slackOauth = { state, organizationId, userId, createdAt: Date.now() };
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id", process.env.SLACK_CLIENT_ID as string);
    url.searchParams.set("scope", OAUTH_SCOPES.join(","));
    url.searchParams.set("redirect_uri", callbackUrl());
    url.searchParams.set("state", state);
    return url.toString();
  }

  static async completeOAuth(req: Request) {
    requireConfiguration();
    const oauth = (req.session as any).slackOauth;
    delete (req.session as any).slackOauth;
    if (!oauth || Date.now() - oauth.createdAt > 10 * 60 * 1000 || !EncryptionService.secureCompare(String(req.query.state || ""), oauth.state)) {
      throw new Error("Slack OAuth state is missing, expired, or invalid");
    }
    if (!req.query.code) throw new Error("Slack authorization code is missing");
    const params = new URLSearchParams({
      code: String(req.query.code),
      redirect_uri: callbackUrl(),
    });
    const basic = Buffer.from(`${process.env.SLACK_CLIENT_ID}:${process.env.SLACK_CLIENT_SECRET}`).toString("base64");
    const response = await axios.post(`${SLACK_API}/oauth.v2.access`, params.toString(), {
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000,
    });
    const data = response.data;
    if (!data?.ok || !data.access_token || !data.team?.id) throw new Error(`Slack OAuth failed: ${data?.error || "invalid_response"}`);
    const result = await db.query(
      `INSERT INTO slack_workspaces
        (organization_id, team_id, team_name, access_token_encrypted, bot_user_id,
         scope, authed_user_id, is_active, created_by, last_verified_at)
       VALUES ($1::UUID, $2, $3, $4, $5, $6, $7, TRUE, $8::UUID, CURRENT_TIMESTAMP)
       ON CONFLICT (organization_id, team_id) DO UPDATE SET
         team_name = EXCLUDED.team_name,
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         bot_user_id = EXCLUDED.bot_user_id,
         scope = EXCLUDED.scope,
         authed_user_id = EXCLUDED.authed_user_id,
         is_active = TRUE,
         last_verified_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *;`,
      [
        oauth.organizationId,
        data.team.id,
        data.team.name,
        EncryptionService.encrypt(data.access_token),
        data.bot_user_id || null,
        data.scope || null,
        data.authed_user?.id || null,
        oauth.userId,
      ],
    );
    const workspace = result.rows[0] as SlackWorkspace;
    await syncChannels(workspace);
    await recordIntegrationAudit({
      organizationId: oauth.organizationId,
      userId: oauth.userId,
      integration: "slack",
      action: "workspace_connected",
      details: { slackTeamId: data.team.id },
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || null,
    });
    return workspace;
  }

  static async disconnect(ownerId: string, userId: string) {
    requireConfiguration();
    const organizationId = await organizationIdForOwner(ownerId);
    const workspace = await workspaceForOrganization(organizationId);
    if (!workspace) return;
    try {
      await slackApi(EncryptionService.decrypt(workspace.access_token_encrypted), "auth.revoke");
    } finally {
      await db.query("DELETE FROM slack_workspaces WHERE id = $1::UUID AND organization_id = $2::UUID;", [workspace.id, organizationId]);
      await recordIntegrationAudit({ organizationId, userId, integration: "slack", action: "workspace_disconnected" });
    }
  }

  static async getChannels(ownerId: string, refresh = false) {
    requireConfiguration();
    const organizationId = await organizationIdForOwner(ownerId);
    const workspace = await workspaceForOrganization(organizationId);
    if (!workspace) throw new Error("Slack workspace is not connected");
    if (refresh) await syncChannels(workspace);
    const result = await db.query(
      `SELECT id, slack_workspace_id, channel_id, channel_name, is_private, is_archived
         FROM slack_channels WHERE slack_workspace_id = $1::UUID
        ORDER BY is_archived, channel_name;`,
      [workspace.id],
    );
    return result.rows;
  }

  static async getConfigs(ownerId: string, projectId?: string) {
    const organizationId = await organizationIdForOwner(ownerId);
    const values: unknown[] = [organizationId];
    const projectFilter = projectId ? "AND p.id = $2::UUID" : "";
    if (projectId) values.push(projectId);
    const result = await db.query(
      `SELECT c.id, p.id AS "projectId", p.name AS "projectName",
              ch.id AS "slackChannelId", ch.channel_name AS "slackChannelName",
              c.notification_types AS "notificationTypes", c.is_active AS "isActive"
         FROM slack_channel_configs c
         JOIN projects p ON p.id = c.project_id
         JOIN teams t ON t.id = p.team_id
         JOIN organizations o ON o.id = $1::UUID
         JOIN slack_channels ch ON ch.id = c.slack_channel_id
         JOIN slack_workspaces w ON w.id = ch.slack_workspace_id AND w.organization_id = o.id
        WHERE (t.organization_id = o.id OR t.user_id = o.user_id) ${projectFilter}
        ORDER BY p.name, ch.channel_name;`,
      values,
    );
    return result.rows;
  }

  static async createConfig(ownerId: string, userId: string, input: any) {
    requireConfiguration();
    const organizationId = await organizationIdForOwner(ownerId);
    const result = await db.query(
      `INSERT INTO slack_channel_configs
        (project_id, slack_channel_id, notification_types, created_by)
       SELECT p.id, ch.id, $3::TEXT[], $4::UUID
         FROM projects p
         JOIN teams t ON t.id = p.team_id
         JOIN organizations o ON o.id = $1::UUID
         JOIN slack_channels ch ON ch.id = $2::UUID
         JOIN slack_workspaces w ON w.id = ch.slack_workspace_id AND w.organization_id = o.id
        WHERE p.id = $5::UUID AND (t.organization_id = o.id OR t.user_id = o.user_id)
       ON CONFLICT (project_id, slack_channel_id) DO UPDATE SET
         notification_types = EXCLUDED.notification_types,
         is_active = TRUE,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id;`,
      [organizationId, input.slackChannelId, input.notificationTypes || [], userId, input.projectId],
    );
    if (!result.rows[0]) throw new Error("Project or Slack channel is outside this organization");
    await recordIntegrationAudit({
      organizationId,
      userId,
      integration: "slack",
      action: "channel_configuration_saved",
      details: { projectId: input.projectId, slackChannelId: input.slackChannelId },
    });
    return (await this.getConfigs(ownerId, input.projectId)).find(row => row.id === result.rows[0].id);
  }

  static async updateConfig(ownerId: string, userId: string, configId: string, isActive: boolean) {
    const organizationId = await organizationIdForOwner(ownerId);
    const result = await db.query(
      `UPDATE slack_channel_configs c SET is_active = $3, updated_at = CURRENT_TIMESTAMP
        FROM slack_channels ch, slack_workspaces w
       WHERE c.id = $1::UUID AND ch.id = c.slack_channel_id
         AND w.id = ch.slack_workspace_id AND w.organization_id = $2::UUID
       RETURNING c.id;`,
      [configId, organizationId, isActive],
    );
    if (!result.rows[0]) throw new Error("Slack channel configuration not found");
    await recordIntegrationAudit({ organizationId, userId, integration: "slack", action: "channel_configuration_updated", details: { configId, isActive } });
  }

  static async deleteConfig(ownerId: string, userId: string, configId: string) {
    const organizationId = await organizationIdForOwner(ownerId);
    const result = await db.query(
      `DELETE FROM slack_channel_configs c USING slack_channels ch, slack_workspaces w
       WHERE c.id = $1::UUID AND ch.id = c.slack_channel_id
         AND w.id = ch.slack_workspace_id AND w.organization_id = $2::UUID
       RETURNING c.id;`,
      [configId, organizationId],
    );
    if (!result.rows[0]) throw new Error("Slack channel configuration not found");
    await recordIntegrationAudit({ organizationId, userId, integration: "slack", action: "channel_configuration_deleted", details: { configId } });
  }

  static async getChannelConfigsByProject(projectId: string) {
    if (!capabilityEnabled()) return [];
    const result = await db.query(
      `SELECT c.id, c.notification_types, ch.channel_id, w.access_token_encrypted
         FROM slack_channel_configs c
         JOIN slack_channels ch ON ch.id = c.slack_channel_id
         JOIN slack_workspaces w ON w.id = ch.slack_workspace_id
         JOIN projects p ON p.id = c.project_id
         JOIN teams t ON t.id = p.team_id
        WHERE c.project_id = $1::UUID AND c.is_active IS TRUE AND w.is_active IS TRUE
          AND (t.organization_id = w.organization_id OR t.user_id = (SELECT user_id FROM organizations WHERE id = w.organization_id));`,
      [projectId],
    );
    return result.rows;
  }

  static async sendNotification(configId: string, notificationType: string, entityType: string, entityId: string, message: Record<string, unknown>) {
    if (!capabilityEnabled()) return;
    const result = await db.query(
      `SELECT c.id, c.notification_types, ch.channel_id, w.access_token_encrypted
         FROM slack_channel_configs c
         JOIN slack_channels ch ON ch.id = c.slack_channel_id
         JOIN slack_workspaces w ON w.id = ch.slack_workspace_id
        WHERE c.id = $1::UUID AND c.is_active IS TRUE AND w.is_active IS TRUE;`,
      [configId],
    );
    const config = result.rows[0];
    if (!config || (notificationType !== "test" && !(config.notification_types || []).includes(notificationType))) return;
    const pending = await db.query(
      `INSERT INTO slack_notifications
        (slack_channel_config_id, notification_type, worklenz_entity_type, worklenz_entity_id, message_payload)
       VALUES ($1::UUID, $2, $3, $4::UUID, $5::JSONB) RETURNING id;`,
      [configId, notificationType, entityType, entityId, JSON.stringify(message)],
    );
    try {
      const sent: any = await slackApi(EncryptionService.decrypt(config.access_token_encrypted), "chat.postMessage", {
        channel: config.channel_id,
        ...message,
      });
      await db.query("UPDATE slack_notifications SET status = 'sent', slack_message_ts = $2, sent_at = CURRENT_TIMESTAMP WHERE id = $1::UUID;", [pending.rows[0].id, sent.ts]);
    } catch (error: any) {
      await db.query("UPDATE slack_notifications SET status = 'failed', error_message = $2 WHERE id = $1::UUID;", [pending.rows[0].id, String(error?.message || error).slice(0, 500)]);
      throw error;
    }
  }

  static async sendTest(ownerId: string, configId: string) {
    const config = (await this.getConfigs(ownerId)).find(row => row.id === configId);
    if (!config) throw new Error("Slack channel configuration not found");
    await this.sendNotification(configId, "test", "project", config.projectId, {
      text: `Worklenz connection verified for ${config.projectName}.`,
    });
  }

  static verifySignature(timestamp: string, signature: string, rawBody: Buffer) {
    if (!capabilityEnabled() || !process.env.SLACK_SIGNING_SECRET || !timestamp || !signature) return false;
    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
    const expected = `v0=${crypto.createHmac("sha256", process.env.SLACK_SIGNING_SECRET).update(`v0:${timestamp}:${rawBody.toString("utf8")}`).digest("hex")}`;
    return EncryptionService.secureCompare(expected, signature);
  }

  static async recordRequest(requestKey: string, requestType: string) {
    // Slack only retries events for a short window. Bound this replay ledger so
    // a public webhook cannot grow it forever.
    await db.query("DELETE FROM slack_request_receipts WHERE received_at < CURRENT_TIMESTAMP - INTERVAL '24 hours';");
    const result = await db.query(
      `INSERT INTO slack_request_receipts (request_key, request_type)
       VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING request_key;`,
      [requestKey, requestType],
    );
    return Boolean(result.rows[0]);
  }

  static async handleEvent(payload: any) {
    if (payload.type === "url_verification") return { challenge: payload.challenge };
    if (!payload.event_id || !(await this.recordRequest(payload.event_id, "event"))) return { ok: true };
    if (["app_uninstalled", "tokens_revoked"].includes(payload.event?.type)) {
      await db.query("UPDATE slack_workspaces SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE team_id = $1;", [payload.team_id]);
    }
    return { ok: true };
  }

  static async handleTaskCommand(form: URLSearchParams) {
    const teamId = form.get("team_id") || "";
    const channelId = form.get("channel_id") || "";
    const slackUserId = form.get("user_id") || "";
    const text = (form.get("text") || "").trim();
    const requestKey = EncryptionService.hash(`${teamId}:${form.get("trigger_id") || ""}:${text}`);
    if (!(await this.recordRequest(requestKey, "command"))) return "This command was already processed.";
    if (!text) return "Usage: /worklenz-task PROJECTKEY Task name";
    const [projectKey, ...nameParts] = text.split(/\s+/);
    const taskName = nameParts.join(" ").trim();
    if (!projectKey || !taskName) return "Usage: /worklenz-task PROJECTKEY Task name";

    const context = await db.query(
      `SELECT w.id AS workspace_id, w.organization_id, w.access_token_encrypted,
              ch.id AS channel_row_id
         FROM slack_workspaces w JOIN slack_channels ch ON ch.slack_workspace_id = w.id
        WHERE w.team_id = $1 AND ch.channel_id = $2 AND w.is_active IS TRUE LIMIT 1;`,
      [teamId, channelId],
    );
    const workspace = context.rows[0];
    if (!workspace) return "This Slack channel is not connected to Worklenz.";

    let mapped = await db.query(
      "SELECT user_id FROM slack_users WHERE slack_workspace_id = $1::UUID AND slack_user_id = $2;",
      [workspace.workspace_id, slackUserId],
    );
    if (!mapped.rows[0]?.user_id) {
      const info: any = await slackApi(EncryptionService.decrypt(workspace.access_token_encrypted), "users.info", { user: slackUserId });
      const email = String(info.user?.profile?.email || "").toLowerCase();
      mapped = await db.query(
        `SELECT u.id AS user_id FROM users u JOIN team_members tm ON tm.user_id = u.id
         JOIN teams t ON t.id = tm.team_id JOIN organizations o ON o.id = $2::UUID
         WHERE LOWER(u.email) = $1 AND (t.organization_id = o.id OR t.user_id = o.user_id) LIMIT 1;`,
        [email, workspace.organization_id],
      );
      if (!mapped.rows[0]?.user_id) return "Your Slack email is not linked to a Worklenz user.";
      await db.query(
        `INSERT INTO slack_users (slack_workspace_id, user_id, slack_user_id, slack_username, slack_email, slack_display_name)
         VALUES ($1::UUID, $2::UUID, $3, $4, $5, $6)
         ON CONFLICT (slack_workspace_id, slack_user_id) DO UPDATE SET user_id = EXCLUDED.user_id, slack_email = EXCLUDED.slack_email;`,
        [workspace.workspace_id, mapped.rows[0].user_id, slackUserId, info.user?.name || null, email, info.user?.profile?.display_name || null],
      );
    }
    const userId = mapped.rows[0].user_id;
    const project = await db.query(
      `SELECT p.id, p.name FROM projects p JOIN team_members tm ON tm.team_id = p.team_id
       JOIN project_members pm ON pm.project_id = p.id AND pm.team_member_id = tm.id
       JOIN slack_channel_configs c ON c.project_id = p.id AND c.slack_channel_id = $3::UUID AND c.is_active IS TRUE
       WHERE UPPER(p.key) = UPPER($1) AND tm.user_id = $2::UUID LIMIT 1;`,
      [projectKey, userId, workspace.channel_row_id],
    );
    if (!project.rows[0]) return "You do not have access to that project, or it is not linked to this channel.";
    const restricted = await db.query("SELECT is_task_creation_restricted($1::UUID, $2::UUID) AS restricted;", [userId, project.rows[0].id]);
    if (restricted.rows[0]?.restricted) return "Task creation is restricted for your Worklenz role.";
    const created = await db.query("SELECT create_quick_task($1::JSON) AS task;", [JSON.stringify({ name: taskName.slice(0, 500), project_id: project.rows[0].id, reporter_id: userId })]);
    const taskId = created.rows[0]?.task?.id || created.rows[0]?.task;
    if (taskId) {
      await recordIntegrationAudit({
        organizationId: workspace.organization_id,
        userId,
        integration: "slack",
        action: "task_created_from_command",
        details: { projectId: project.rows[0].id, taskId, slackTeamId: teamId },
      });
    }
    return taskId ? `Created “${taskName.slice(0, 120)}” in ${project.rows[0].name}.` : "Worklenz could not create the task.";
  }
}
