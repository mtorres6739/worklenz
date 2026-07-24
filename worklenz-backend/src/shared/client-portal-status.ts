export type PortalClientStatus =
  "active" | "inactive" | "invited" | "not_invited";

export function resolvePortalClientStatus(row: {
  status?: string | null;
  client_portal_enabled?: boolean | null;
  has_active_membership?: boolean | null;
  invitation_status?: string | null;
}): { status: PortalClientStatus; label: string; color: string } {
  if (row.status === "inactive") {
    return { status: "inactive", label: "Inactive", color: "default" };
  }
  if (
    row.status === "active" &&
    row.client_portal_enabled &&
    row.has_active_membership
  ) {
    return { status: "active", label: "Active", color: "green" };
  }
  if (row.invitation_status === "pending") {
    return { status: "invited", label: "Invited", color: "blue" };
  }
  return {
    status: "not_invited",
    label: "Not invited",
    color: "default",
  };
}
