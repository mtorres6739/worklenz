import { resolvePortalClientStatus } from "../shared/client-portal-status";

describe("client portal status", () => {
  it("keeps a deactivated client inactive even with an accepted membership", () => {
    expect(
      resolvePortalClientStatus({
        status: "inactive",
        client_portal_enabled: false,
        has_active_membership: true,
      }),
    ).toMatchObject({ status: "inactive", label: "Inactive" });
  });

  it("reports active access only when the client, portal, and membership are active", () => {
    expect(
      resolvePortalClientStatus({
        status: "active",
        client_portal_enabled: true,
        has_active_membership: true,
      }),
    ).toMatchObject({ status: "active", label: "Active" });

    expect(
      resolvePortalClientStatus({
        status: "active",
        client_portal_enabled: false,
        has_active_membership: true,
      }),
    ).toMatchObject({ status: "not_invited" });
  });

  it("preserves invitation state before a client accepts", () => {
    expect(
      resolvePortalClientStatus({
        status: "pending",
        client_portal_enabled: true,
        has_active_membership: false,
        invitation_status: "pending",
      }),
    ).toMatchObject({ status: "invited", label: "Invited" });
  });
});
