jest.mock("../config/db", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));
jest.mock("../shared/utils", () => ({ log_error: jest.fn() }));

import db from "../config/db";
import { verifyProjectAccessSocket } from "../socket.io/authorization";
import { registerClientPortalSocketHandlers } from "../socket.io/client-portal";

describe("Socket.IO project-room authorization", () => {
  const query = db.query as jest.Mock;

  beforeEach(() => query.mockReset());

  it("rejects an unauthenticated room request without touching the database", async () => {
    const allowed = await verifyProjectAccessSocket({ request: {} } as any, "project-id");
    expect(allowed).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it("requires an owner, admin, team lead, or explicit project membership", async () => {
    query.mockResolvedValue({ rowCount: 1 });
    const socket = {
      request: { session: { passport: { user: { id: "staff-user-id" } } } },
    } as any;
    await expect(verifyProjectAccessSocket(socket, "project-id")).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("pm.id IS NOT NULL"),
      ["project-id", "staff-user-id"],
    );
    expect(query.mock.calls[0][0]).toContain("r.owner = TRUE");
    expect(query.mock.calls[0][0]).toContain("r.admin_role = TRUE");
  });
});

describe("client portal Socket.IO isolation", () => {
  const query = db.query as jest.Mock;

  beforeEach(() => query.mockReset());

  it("joins only actor-scoped rooms backed by active visible grants", async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ project_id: "project-a" }] });
    const handlers: Record<string, (...args: any[]) => unknown> = {};
    const socket = {
      data: {
        portalActor: {
          clientUserId: "portal-user-a",
          membershipId: "membership-a",
          teamId: "team-a",
          clientId: "client-a",
        },
      },
      join: jest.fn(),
      emit: jest.fn(),
      on: jest.fn((event: string, handler: (...args: any[]) => unknown) => {
        handlers[event] = handler;
      }),
    } as any;

    await registerClientPortalSocketHandlers({} as any, socket);

    expect(socket.join).toHaveBeenCalledWith("portal:user:portal-user-a");
    expect(socket.join).toHaveBeenCalledWith("portal:membership:membership-a");
    expect(socket.join).toHaveBeenCalledWith("portal:client:team-a:client-a");
    expect(socket.join).toHaveBeenCalledWith("portal:project:project-a");
    expect(query.mock.calls[0][0]).toContain("c.client_portal_enabled = TRUE");
    expect(query.mock.calls[0][0]).toContain("p.client_portal_visible = TRUE");
    expect(handlers["portal:join-project"]).toBeDefined();
  });
});
