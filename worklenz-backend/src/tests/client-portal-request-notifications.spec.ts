jest.mock("../config/db", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import {
  createClientRequestNotifications,
  createStaffRequestNotifications,
  emitRequestEvent,
} from "../services/client-portal-request-notifications.service";
import { IO } from "../shared/io";

const event = {
  requestId: "33333333-3333-4333-8333-333333333333",
  requestNo: "WEB-000001",
  teamId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  eventType: "request_comment_added" as const,
  title: "New comment",
  message: "A client commented on WEB-000001.",
};

describe("client portal request notifications", () => {
  const previousEnvironment = process.env;

  beforeEach(() => {
    process.env = {
      ...previousEnvironment,
      FEATURE_CLIENT_PORTAL: "true",
      FEATURE_CLIENT_PORTAL_SERVICES: "true",
      FEATURE_CLIENT_PORTAL_REQUESTS: "true",
      FEATURE_CLIENT_PORTAL_REQUEST_NOTIFICATIONS: "true",
    };
  });

  afterAll(() => {
    process.env = previousEnvironment;
  });

  it("fails closed without its independent release flag", async () => {
    delete process.env.FEATURE_CLIENT_PORTAL_REQUEST_NOTIFICATIONS;
    const query = jest.fn();

    await expect(
      createStaffRequestNotifications({ query } as any, event),
    ).resolves.toEqual([]);
    await createClientRequestNotifications({ query } as any, event);
    emitRequestEvent(event, ["staff-a"]);

    expect(query).not.toHaveBeenCalled();
  });

  it("creates staff notifications only for scoped administrators and the assignee", async () => {
    const query = jest
      .fn()
      .mockResolvedValue({ rows: [{ user_id: "staff-a" }], rowCount: 1 });

    await expect(
      createStaffRequestNotifications({ query } as any, {
        ...event,
        assignedUserId: "44444444-4444-4444-8444-444444444444",
        excludeUserId: "55555555-5555-4555-8555-555555555555",
      }),
    ).resolves.toEqual(["staff-a"]);

    expect(query.mock.calls[0][0]).toContain("tm.team_id = $1::UUID");
    expect(query.mock.calls[0][0]).toContain("r.name = 'Admin'");
    expect(query.mock.calls[0][0]).toContain(
      "recipients.user_id <> $5::UUID",
    );
    expect(query.mock.calls[0][1][0]).toBe(event.teamId);
    expect(query.mock.calls[0][1][2]).toBe(event.requestId);
  });

  it("creates client notifications only for active accepted memberships in the request scope", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 2 });

    await createClientRequestNotifications({ query } as any, {
      ...event,
      excludeMembershipId: "66666666-6666-4666-8666-666666666666",
    });

    expect(query.mock.calls[0][0]).toContain("pcm.team_id = $1::UUID");
    expect(query.mock.calls[0][0]).toContain("pcm.client_id = $2::UUID");
    expect(query.mock.calls[0][0]).toContain("pcm.accepted_at IS NOT NULL");
    expect(query.mock.calls[0][0]).toContain("pcu.status = 'active'");
    expect(query.mock.calls[0][0]).toContain(
      "pcm.id <> $8::UUID",
    );
    expect(query.mock.calls[0][1].slice(0, 4)).toEqual([
      event.teamId,
      event.clientId,
      event.requestId,
      event.eventType,
    ]);
  });

  it("emits staff events only to explicit recipient rooms and the scoped client room", () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    IO.setInstance({ to } as any);

    emitRequestEvent(event, ["staff-a", "staff-a", "staff-b"]);

    expect(to).toHaveBeenCalledWith("staff:user:staff-a");
    expect(to).toHaveBeenCalledWith("staff:user:staff-b");
    expect(to).toHaveBeenCalledWith(
      `portal:client:${event.teamId}:${event.clientId}`,
    );
    expect(to).not.toHaveBeenCalledWith(`staff:team:${event.teamId}`);
  });
});
