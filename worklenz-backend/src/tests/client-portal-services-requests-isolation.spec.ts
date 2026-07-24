jest.mock("../config/db", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

import db from "../config/db";
import ClientPortalServicesRequestsController from "../controllers/client-portal-services-requests-controller";
import ClientPortalServicesRequestsAdminController from "../controllers/client-portal-services-requests-admin-controller";

function response() {
  const res = {
    status: jest.fn(),
    send: jest.fn(),
  } as any;
  res.status.mockReturnValue(res);
  res.send.mockReturnValue(res);
  return res;
}

describe("client portal services and requests isolation", () => {
  const query = db.query as jest.Mock;

  beforeEach(() => query.mockReset());

  it("lists only services public or assigned to the active client scope", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    const req = {
      portalActor: {
        teamId: "11111111-1111-4111-8111-111111111111",
        clientId: "22222222-2222-4222-8222-222222222222",
      },
    } as any;

    await ClientPortalServicesRequestsController.services(req, response());

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("psc.client_id = $2::UUID"),
      [req.portalActor.teamId, req.portalActor.clientId],
    );
    expect(query.mock.calls[0][0]).toContain("ps.team_id = $1::UUID");
    expect(query.mock.calls[0][0]).toContain("ps.status = 'active'");
  });

  it("looks up client requests through team and client scope together", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    const req = {
      params: { id: "33333333-3333-4333-8333-333333333333" },
      portalActor: {
        teamId: "11111111-1111-4111-8111-111111111111",
        clientId: "22222222-2222-4222-8222-222222222222",
      },
    } as any;
    const res = response();

    await ClientPortalServicesRequestsController.request(req, res);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("pr.client_id = $3::UUID"),
      [req.params.id, req.portalActor.teamId, req.portalActor.clientId],
    );
    expect(query.mock.calls[0][0]).toContain("pr.team_id = $2::UUID");
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("rejects client-supplied attachment metadata until private attachment APIs ship", async () => {
    const req = {
      body: {
        service_id: "33333333-3333-4333-8333-333333333333",
        request_data: {
          title: "Unsafe attachment injection",
          attachments: [{ url: "https://example.invalid/untrusted" }],
        },
      },
      portalActor: {
        teamId: "11111111-1111-4111-8111-111111111111",
        clientId: "22222222-2222-4222-8222-222222222222",
      },
    } as any;
    const res = response();

    await ClientPortalServicesRequestsController.createRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("lists staff requests only inside the staff session team", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    const req = {
      user: {
        id: "44444444-4444-4444-8444-444444444444",
        team_id: "11111111-1111-4111-8111-111111111111",
      },
      query: {},
    } as any;

    await ClientPortalServicesRequestsAdminController.listRequests(
      req,
      response(),
    );

    expect(query.mock.calls[0][0]).toContain("pr.team_id = $1::UUID");
    expect(query.mock.calls[0][1][0]).toBe(req.user.team_id);
  });
});
