export const SELF_HOSTED_CAPABILITY_KEYS = [
  "unlimitedProjects",
  "unlimitedTeams",
  "unlimitedMembers",
  "schedule",
  "reporting",
  "teamReports",
  "projectInsights",
  "roadmap",
  "workload",
  "allocations",
  "projectPhases",
  "projectPriorities",
  "projectCategories",
  "projectManagers",
  "projectTaskRestrictions",
  "taskTemplates",
  "projectTemplates",
  "recurringTasks",
  "taskDependencies",
  "taskArchive",
  "taskSubscribers",
  "billableTasks",
  "activityHistory",
  "customFields",
  "organizationBranding",
  "projectFinance",
  "clientPortal",
  "clientPortalServices",
  "clientPortalRequests",
  "slack",
  "oidc",
  "microsoftTeams",
  "github",
  "googleDrive",
  "googleCalendar",
  "microsoftCalendar",
  "curatedPlugins",
] as const;

export type SelfHostedCapabilityKey =
  (typeof SELF_HOSTED_CAPABILITY_KEYS)[number];

export interface SelfHostedCapabilities {
  profile: "self_hosted_full";
  schemaVersion: 1;
  capabilities: Record<SelfHostedCapabilityKey, boolean>;
  limits: {
    activeProjects: null;
    teamMembers: null;
    customFields: null;
    historyDays: null;
    storageBytes: null;
    uploadBytes: number;
  };
}

const DEFAULT_UPLOAD_BYTES = 250 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

export function getConfiguredUploadBytes(): number {
  const configured = Number(
    process.env.MAX_UPLOAD_BYTES || DEFAULT_UPLOAD_BYTES,
  );
  if (!Number.isFinite(configured) || configured <= 0)
    return DEFAULT_UPLOAD_BYTES;
  return Math.min(Math.floor(configured), MAX_UPLOAD_BYTES);
}

export function getJsonUploadBodyLimitBytes(): number {
  return Math.ceil((getConfiguredUploadBytes() * 4) / 3) + 1024 * 1024;
}

/**
 * Capabilities are explicit so incomplete integrations cannot become visible merely because
 * this deployment has no SaaS subscription. Commercially gated core features are enabled;
 * server-backed modules are flipped on only after their implementation passes its rollout gate.
 */
export function getSelfHostedCapabilities(): SelfHostedCapabilities {
  const configuredProfile = process.env.FEATURE_PROFILE || "self_hosted_full";
  if (configuredProfile !== "self_hosted_full") {
    throw new Error(`Unsupported FEATURE_PROFILE: ${configuredProfile}`);
  }
  const clientPortalEnabled = process.env.FEATURE_CLIENT_PORTAL === "true";
  const clientPortalServicesEnabled =
    clientPortalEnabled &&
    process.env.FEATURE_CLIENT_PORTAL_SERVICES === "true";
  return {
    profile: "self_hosted_full",
    schemaVersion: 1,
    capabilities: {
      unlimitedProjects: true,
      unlimitedTeams: true,
      unlimitedMembers: true,
      schedule: true,
      reporting: true,
      teamReports: true,
      projectInsights: true,
      roadmap: true,
      workload: true,
      allocations: true,
      projectPhases: true,
      projectPriorities: true,
      projectCategories: true,
      projectManagers: true,
      projectTaskRestrictions: true,
      taskTemplates: true,
      projectTemplates: true,
      recurringTasks: true,
      taskDependencies: true,
      taskArchive: true,
      taskSubscribers: true,
      billableTasks: true,
      activityHistory: true,
      customFields: true,
      organizationBranding: true,
      projectFinance: process.env.FEATURE_PROJECT_FINANCE === "true",
      clientPortal: clientPortalEnabled,
      clientPortalServices: clientPortalServicesEnabled,
      clientPortalRequests:
        clientPortalServicesEnabled &&
        process.env.FEATURE_CLIENT_PORTAL_REQUESTS === "true",
      slack: process.env.FEATURE_SLACK === "true",
      oidc: process.env.FEATURE_OIDC === "true",
      microsoftTeams: process.env.FEATURE_MICROSOFT_TEAMS === "true",
      github: process.env.FEATURE_GITHUB === "true",
      googleDrive: process.env.FEATURE_GOOGLE_DRIVE === "true",
      googleCalendar: process.env.FEATURE_GOOGLE_CALENDAR === "true",
      microsoftCalendar: process.env.FEATURE_MICROSOFT_CALENDAR === "true",
      curatedPlugins: process.env.FEATURE_CURATED_PLUGINS === "true",
    },
    limits: {
      activeProjects: null,
      teamMembers: null,
      customFields: null,
      historyDays: null,
      storageBytes: null,
      uploadBytes: getConfiguredUploadBytes(),
    },
  };
}
