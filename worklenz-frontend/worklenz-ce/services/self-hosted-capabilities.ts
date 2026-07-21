import apiClient from '@/api/api-client';
import { API_BASE_URL } from '@/shared/constants';
import type {
  ISelfHostedCapabilities,
  SelfHostedCapabilityKey,
} from '../types/business-features.types';

const enabledCoreCapabilities: SelfHostedCapabilityKey[] = [
  'unlimitedProjects',
  'unlimitedTeams',
  'unlimitedMembers',
  'schedule',
  'reporting',
  'teamReports',
  'projectInsights',
  'roadmap',
  'workload',
  'allocations',
  'projectPhases',
  'projectPriorities',
  'projectCategories',
  'projectManagers',
  'projectTaskRestrictions',
  'taskTemplates',
  'projectTemplates',
  'recurringTasks',
  'taskDependencies',
  'taskArchive',
  'taskSubscribers',
  'billableTasks',
  'activityHistory',
  'customFields',
  'organizationBranding',
];

const capabilityKeys: SelfHostedCapabilityKey[] = [
  ...enabledCoreCapabilities,
  'projectFinance',
  'clientPortal',
  'slack',
  'oidc',
  'microsoftTeams',
  'github',
  'googleDrive',
  'googleCalendar',
  'microsoftCalendar',
  'curatedPlugins',
];

const defaultCapabilities = Object.fromEntries(
  capabilityKeys.map(key => [key, enabledCoreCapabilities.includes(key)])
) as Record<SelfHostedCapabilityKey, boolean>;

export const DEFAULT_SELF_HOSTED_CAPABILITIES: ISelfHostedCapabilities = {
  profile: 'self_hosted_full',
  schemaVersion: 1,
  capabilities: defaultCapabilities,
  limits: {
    activeProjects: null,
    teamMembers: null,
    customFields: null,
    historyDays: null,
    storageBytes: null,
    uploadBytes: 250 * 1024 * 1024,
  },
};

type Snapshot = {
  value: ISelfHostedCapabilities;
  loaded: boolean;
};

let snapshot: Snapshot = {
  value: DEFAULT_SELF_HOSTED_CAPABILITIES,
  loaded: false,
};
let request: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function getCapabilitiesSnapshot(): Snapshot {
  return snapshot;
}

export function subscribeToCapabilities(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: Snapshot): void {
  snapshot = next;
  listeners.forEach(listener => listener());
}

export function loadSelfHostedCapabilities(): Promise<void> {
  if (snapshot.loaded) return Promise.resolve();
  if (request) return request;

  request = apiClient
    .get<{ done: boolean; body: ISelfHostedCapabilities }>(`${API_BASE_URL}/system/capabilities`)
    .then(response => {
      if (response.data.done && response.data.body?.profile === 'self_hosted_full') {
        publish({ value: response.data.body, loaded: true });
        return;
      }
      publish({ value: DEFAULT_SELF_HOSTED_CAPABILITIES, loaded: true });
    })
    .catch(() => {
      // Core self-hosted features remain available if the capability request is temporarily
      // unavailable. Server-backed modules default off and therefore fail closed.
      publish({ value: DEFAULT_SELF_HOSTED_CAPABILITIES, loaded: true });
    })
    .finally(() => {
      request = null;
    });

  return request;
}
