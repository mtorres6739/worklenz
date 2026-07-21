#!/usr/bin/env node

"use strict";

const bcrypt = require("bcrypt");
const { Pool } = require("pg");
const WebSocket = require("ws");

const db = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
});

const baseUrl = process.env.ISOLATION_BASE_URL || "http://worklenz-client-portal-backend:3000";
const origin = process.env.APP_ORIGIN || "https://client-portal-isolation.invalid";
const password = "Isolation-Only-Password!47";
const runId = `${Date.now()}-${process.pid}`;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

async function request(path, options = {}) {
  const headers = {
    accept: "application/json",
    origin,
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.csrf ? { "x-client-csrf": options.csrf } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: "manual",
  });
  let json = null;
  const text = await response.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { response, json };
}

function expectStatus(result, status, label) {
  invariant(
    result.response.status === status,
    `${label}: expected HTTP ${status}, received ${result.response.status} (${JSON.stringify(result.json)})`,
  );
  return result.json;
}

function cookieFrom(response) {
  const header = response.headers.get("set-cookie") || "";
  invariant(/worklenz\.client\.sid=[0-9a-f]{64}/i.test(header), "login did not issue the client session cookie");
  invariant(/HttpOnly/i.test(header), "client session cookie is not HttpOnly");
  invariant(/Secure/i.test(header), "client session cookie is not Secure");
  invariant(/SameSite=Lax/i.test(header), "client session cookie is not SameSite=Lax");
  return header.split(";", 1)[0];
}

async function login(email) {
  const result = await request("/api/client-portal/auth/login", {
    method: "POST",
    body: { email, password },
  });
  const json = expectStatus(result, 200, `login ${email}`);
  invariant(json?.body?.audience === "client_portal", "login returned the wrong session audience");
  invariant(/^[0-9a-f]{64}$/i.test(json?.body?.csrf_token || ""), "login did not return a CSRF token");
  return {
    cookie: cookieFrom(result.response),
    csrf: json.body.csrf_token,
    body: json.body,
  };
}

class PortalSocket {
  constructor(cookie) {
    this.cookie = cookie;
    this.ready = null;
    this.acks = new Map();
    this.nextAck = 1;
    this.closed = false;
  }

  async connect() {
    const socketUrl = baseUrl.replace(/^http/, "ws") + "/socket/?EIO=4&transport=websocket";
    this.ws = new WebSocket(socketUrl, { headers: { Cookie: this.cookie, Origin: origin } });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Socket.IO connection timed out")), 10000);
      this.ws.on("error", reject);
      this.ws.on("close", () => {
        this.closed = true;
      });
      this.ws.on("message", raw => {
        const message = String(raw);
        if (message.startsWith("0")) {
          this.ws.send("40");
          return;
        }
        if (message === "2") {
          this.ws.send("3");
          return;
        }
        if (message.startsWith("42")) {
          const payload = JSON.parse(message.slice(2));
          if (payload[0] === "portal:ready") {
            this.ready = payload[1];
            clearTimeout(timeout);
            resolve();
          }
          return;
        }
        const ack = message.match(/^43(\d+)(.*)$/);
        if (ack) {
          const pending = this.acks.get(Number(ack[1]));
          if (pending) {
            this.acks.delete(Number(ack[1]));
            pending(JSON.parse(ack[2]));
          }
        }
      });
    });
    return this.ready;
  }

  async joinProject(projectId) {
    const ackId = this.nextAck++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.acks.delete(ackId);
        reject(new Error("Socket.IO project-room acknowledgement timed out"));
      }, 5000);
      this.acks.set(ackId, payload => {
        clearTimeout(timeout);
        resolve(payload[0]);
      });
      this.ws.send(`42${ackId}${JSON.stringify(["portal:join-project", projectId])}`);
    });
  }

  async expectServerDisconnect() {
    if (this.closed) return;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Portal socket remained connected after logout")), 5000);
      this.ws.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  close() {
    if (this.ws && !this.closed) this.ws.close();
  }
}

async function seed() {
  const actor = await db.query(`
    SELECT tm.team_id, tm.user_id
      FROM team_members tm
      JOIN users u ON u.id = tm.user_id AND u.is_deleted = FALSE
      JOIN teams t ON t.id = tm.team_id
     ORDER BY t.created_at, tm.created_at
     LIMIT 1
  `);
  invariant(actor.rowCount === 1, "backup clone has no active team member for fixture ownership");
  const { team_id: teamId, user_id: userId } = actor.rows[0];
  const defaults = await db.query(`
    SELECT
      (SELECT id FROM sys_project_statuses ORDER BY sort_order NULLS LAST, name LIMIT 1) AS status_id,
      (SELECT id FROM sys_project_healths ORDER BY name LIMIT 1) AS health_id,
      (SELECT id FROM task_priorities WHERE name = 'Medium' LIMIT 1) AS priority_id
  `);
  const { status_id: statusId, health_id: healthId, priority_id: priorityId } = defaults.rows[0];
  invariant(statusId && healthId && priorityId, "backup clone is missing project/task defaults");

  async function createSide(side, accessLevel, canViewFiles) {
    const projectName = `Portal Isolation ${side} ${runId}`;
    const clientName = `Portal Isolation Client ${side} ${runId}`;
    const email = `portal-isolation-${side.toLowerCase()}-${runId}@invalid.example`;
    const key = `PI${side}${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 99)}`.slice(0, 15);
    const body = {
      name: projectName,
      key,
      notes: "Disposable client-portal isolation fixture",
      color_code: "#3b82f6",
      team_id: teamId,
      user_id: userId,
      client_name: clientName,
      status_id: statusId,
      health_id: healthId,
      working_days: 5,
      man_days: 1,
      hours_per_day: 8,
      use_manual_progress: false,
      use_weighted_progress: false,
      use_time_progress: false,
      project_created_log: "Isolation fixture created by @user",
    };
    const created = await db.query("SELECT create_project($1::JSON) AS project", [JSON.stringify(body)]);
    const projectId = created.rows[0].project.id;
    const client = await db.query(
      "SELECT id FROM clients WHERE team_id = $1::UUID AND name = $2 LIMIT 1",
      [teamId, clientName],
    );
    invariant(client.rowCount === 1, `client ${side} fixture was not created`);
    const clientId = client.rows[0].id;
    await db.query(
      `UPDATE clients SET client_portal_enabled = TRUE, status = 'active', company_name = $3
        WHERE id = $1::UUID AND team_id = $2::UUID`,
      [clientId, teamId, clientName],
    );
    await db.query(
      `UPDATE projects SET client_portal_visible = TRUE, client_portal_access_level = $3
        WHERE id = $1::UUID AND team_id = $2::UUID`,
      [projectId, teamId, accessLevel],
    );
    const passwordHash = await bcrypt.hash(password, 12);
    const portalUser = await db.query(
      `INSERT INTO portal_client_users (email, name, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      [email, `Portal Client ${side}`, passwordHash],
    );
    const membership = await db.query(
      `INSERT INTO portal_client_memberships
         (client_user_id, team_id, client_id, role, access_level, is_active, invited_by, accepted_at)
       VALUES ($1::UUID, $2::UUID, $3::UUID, 'member', $4, TRUE, $5::UUID, CURRENT_TIMESTAMP)
       RETURNING id`,
      [portalUser.rows[0].id, teamId, clientId, accessLevel, userId],
    );
    await db.query(
      `INSERT INTO portal_project_access
         (team_id, client_id, project_id, access_level, can_view_files, created_by)
       VALUES ($1::UUID, $2::UUID, $3::UUID, $4, $5, $6::UUID)`,
      [teamId, clientId, projectId, accessLevel, canViewFiles, userId],
    );
    const status = await db.query(
      "SELECT id FROM task_statuses WHERE project_id = $1::UUID ORDER BY sort_order LIMIT 1",
      [projectId],
    );
    const task = await db.query(
      `INSERT INTO tasks
         (name, description, total_minutes, priority_id, project_id, reporter_id, status_id,
          sort_order, roadmap_sort_order, status_sort_order, priority_sort_order, phase_sort_order, member_sort_order)
       VALUES ($1, $2, 0, $3::UUID, $4::UUID, $5::UUID, $6::UUID, 1, 1, 1, 1, 1, 1)
       RETURNING id`,
      [`Portal ${side} private task`, `Only Client ${side} may see this`, priorityId, projectId, userId, status.rows[0].id],
    );
    const file = await db.query(
      `INSERT INTO project_files (name, size, type, project_id, team_id, uploaded_by)
       VALUES ($1, 128, 'application/pdf', $2::UUID, $3::UUID, $4::UUID)
       RETURNING id`,
      [`portal-${side.toLowerCase()}-private.pdf`, projectId, teamId, userId],
    );
    return {
      side,
      email,
      teamId,
      userId,
      clientId,
      clientUserId: portalUser.rows[0].id,
      membershipId: membership.rows[0].id,
      projectId,
      taskId: task.rows[0].id,
      fileId: file.rows[0].id,
    };
  }

  return {
    a: await createSide("A", "comment", true),
    b: await createSide("B", "view", false),
  };
}

async function run() {
  const fixture = await seed();

  expectStatus(await request("/api/client-portal/auth/session"), 401, "anonymous session");
  expectStatus(
    await request("/api/client-portal/auth/session", { headers: { authorization: "Bearer isolation-token" } }),
    401,
    "bearer token rejected",
  );
  expectStatus(
    await request("/api/client-portal/auth/login", {
      method: "POST",
      headers: { origin: "https://cross-origin.invalid" },
      body: { email: fixture.a.email, password },
    }),
    403,
    "cross-origin login",
  );

  const a = await login(fixture.a.email);
  const b = await login(fixture.b.email);
  invariant(a.body.active.client_id === fixture.a.clientId, "Client A received the wrong tenant membership");
  invariant(b.body.active.client_id === fixture.b.clientId, "Client B received the wrong tenant membership");

  const aProjects = expectStatus(
    await request("/api/client-portal/projects", { cookie: a.cookie }),
    200,
    "Client A project list",
  );
  invariant(aProjects.body.total === 1, "Client A project list was not tenant-isolated");
  invariant(aProjects.body.projects[0].id === fixture.a.projectId, "Client A saw a foreign project");
  const bProjects = expectStatus(
    await request("/api/client-portal/projects", { cookie: b.cookie }),
    200,
    "Client B project list",
  );
  invariant(bProjects.body.total === 1, "Client B project list was not tenant-isolated");
  invariant(bProjects.body.projects[0].id === fixture.b.projectId, "Client B saw a foreign project");

  for (const [path, label] of [
    [`/api/client-portal/projects/${fixture.b.projectId}`, "foreign project"],
    [`/api/client-portal/projects/${fixture.b.projectId}/tasks`, "foreign task list"],
    [`/api/client-portal/projects/${fixture.b.projectId}/tasks/${fixture.b.taskId}`, "foreign task"],
    [`/api/client-portal/projects/${fixture.b.projectId}/tasks/${fixture.b.taskId}/comments`, "foreign comments"],
    [`/api/client-portal/projects/${fixture.b.projectId}/files`, "foreign files"],
    [`/api/client-portal/projects/${fixture.b.projectId}/files/${fixture.b.fileId}/download`, "foreign file download"],
  ]) {
    expectStatus(await request(path, { cookie: a.cookie }), 404, `Client A ${label}`);
  }

  const aTasks = expectStatus(
    await request(`/api/client-portal/projects/${fixture.a.projectId}/tasks`, { cookie: a.cookie }),
    200,
    "Client A tasks",
  );
  invariant(aTasks.body.total === 1 && aTasks.body.tasks[0].id === fixture.a.taskId, "Client A task list leaked data");
  expectStatus(
    await request(`/api/client-portal/projects/${fixture.a.projectId}/tasks/${fixture.b.taskId}`, { cookie: a.cookie }),
    404,
    "cross-project task identifier",
  );

  expectStatus(
    await request(`/api/client-portal/projects/${fixture.a.projectId}/tasks/${fixture.a.taskId}/comments`, {
      method: "POST",
      cookie: a.cookie,
      csrf: "0".repeat(64),
      body: { comment: "must fail" },
    }),
    403,
    "invalid CSRF",
  );
  expectStatus(
    await request(`/api/client-portal/projects/${fixture.a.projectId}/tasks/${fixture.a.taskId}/comments`, {
      method: "POST",
      cookie: a.cookie,
      csrf: a.csrf,
      body: { comment: "Client A isolated comment" },
    }),
    201,
    "Client A comment",
  );
  const aComments = expectStatus(
    await request(`/api/client-portal/projects/${fixture.a.projectId}/tasks/${fixture.a.taskId}/comments`, { cookie: a.cookie }),
    200,
    "Client A comments",
  );
  invariant(aComments.body.total === 1, "Client A comment was not isolated or persisted");
  expectStatus(
    await request(`/api/client-portal/projects/${fixture.b.projectId}/tasks/${fixture.b.taskId}/comments`, {
      method: "POST",
      cookie: b.cookie,
      csrf: b.csrf,
      body: { comment: "read-only client must fail" },
    }),
    403,
    "Client B read-only comment",
  );

  const aFiles = expectStatus(
    await request(`/api/client-portal/projects/${fixture.a.projectId}/files`, { cookie: a.cookie }),
    200,
    "Client A files",
  );
  invariant(aFiles.body.total === 1 && aFiles.body.files[0].id === fixture.a.fileId, "Client A file list leaked data");
  const signed = expectStatus(
    await request(`/api/client-portal/projects/${fixture.a.projectId}/files/${fixture.a.fileId}/download`, { cookie: a.cookie }),
    200,
    "Client A authorized file download",
  );
  invariant(signed.body.expires_in === 900, "authorized file URL is not limited to 15 minutes");
  invariant(/^https:\/\//.test(signed.body.url), "authorized file response did not contain an HTTPS signed URL");
  expectStatus(
    await request(`/api/client-portal/projects/${fixture.b.projectId}/files`, { cookie: b.cookie }),
    403,
    "Client B disabled file access",
  );

  const socketA = new PortalSocket(a.cookie);
  const socketB = new PortalSocket(b.cookie);
  const readyA = await socketA.connect();
  const readyB = await socketB.connect();
  invariant(
    readyA.clientId === fixture.a.clientId && JSON.stringify(readyA.projectIds) === JSON.stringify([fixture.a.projectId]),
    "Client A Socket.IO rooms were not isolated",
  );
  invariant(
    readyB.clientId === fixture.b.clientId && JSON.stringify(readyB.projectIds) === JSON.stringify([fixture.b.projectId]),
    "Client B Socket.IO rooms were not isolated",
  );
  invariant((await socketA.joinProject(fixture.a.projectId)).ok === true, "Client A could not join its project room");
  invariant((await socketA.joinProject(fixture.b.projectId)).ok === false, "Client A joined Client B's project room");
  invariant((await socketB.joinProject(fixture.a.projectId)).ok === false, "Client B joined Client A's project room");

  expectStatus(
    await request("/api/client-portal/auth/logout", {
      method: "POST",
      cookie: a.cookie,
      csrf: a.csrf,
      body: {},
    }),
    200,
    "Client A logout",
  );
  await socketA.expectServerDisconnect();
  expectStatus(await request("/api/client-portal/auth/session", { cookie: a.cookie }), 401, "revoked Client A session");

  socketB.close();
  const audit = await db.query(
    `SELECT COUNT(*)::INT AS count FROM portal_audit_log
      WHERE team_id = $1::UUID AND client_id IN ($2::UUID, $3::UUID)`,
    [fixture.a.teamId, fixture.a.clientId, fixture.b.clientId],
  );
  invariant(audit.rows[0].count >= 4, "portal security activity was not recorded in the audit log");

  console.log("Client Portal isolation rehearsal passed: auth, cookies, CSRF, APIs, comments, files, audit, Socket.IO rooms, and logout revocation.");
}

run()
  .catch(error => {
    console.error(`Client Portal isolation rehearsal failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end().catch(() => undefined);
  });

