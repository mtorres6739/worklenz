import { IUpgradePrompt } from '../types/business-features.types';

/**
 * Compatibility adapter for shared components that have not yet migrated to explicit
 * capabilities. Self-hosted builds never open billing or pricing surfaces.
 */
export function useUpgradePrompt(): IUpgradePrompt {
  return { promptUpgrade: () => undefined, isUpgradeOpen: false };
}
