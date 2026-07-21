import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { IBusinessFeatures, SelfHostedCapabilityKey } from '../types/business-features.types';
import {
  getCapabilitiesSnapshot,
  loadSelfHostedCapabilities,
  subscribeToCapabilities,
} from '../services/self-hosted-capabilities';

/**
 * The SDM CE fork has no SaaS subscription. Core self-hosted features are unrestricted, while
 * server-backed modules are exposed only when the authenticated capability endpoint enables them.
 */
export function useBusinessFeatures(): IBusinessFeatures {
  const snapshot = useSyncExternalStore(
    subscribeToCapabilities,
    getCapabilitiesSnapshot,
    getCapabilitiesSnapshot
  );

  useEffect(() => {
    void loadSelfHostedCapabilities();
  }, []);

  const hasCapability = useCallback(
    (capability: SelfHostedCapabilityKey) => snapshot.value.capabilities[capability] === true,
    [snapshot.value]
  );

  return {
    hasBusinessAccess: true,
    isBusinessPlan: true,
    isEnterprisePlan: true,
    isFreeUser: false,
    isOnBusinessTrial: false,
    planTrialDaysRemaining: 0,
    shouldRestrictBillable: false,
    selfHosted: snapshot.value,
    capabilitiesLoaded: snapshot.loaded,
    hasCapability,
  };
}
