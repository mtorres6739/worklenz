import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectIntegrationsButton } from './ProjectIntegrationsButton';

const mocks = vi.hoisted(() => ({
  capabilitiesLoaded: true,
  hasSlackCapability: false,
  getStatus: vi.fn(),
  getProjectChannelConfigs: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue || _key,
  }),
}));

vi.mock('@/worklenz-ee/hooks/use-business-features', () => ({
  useBusinessFeatures: () => ({
    capabilitiesLoaded: mocks.capabilitiesLoaded,
    hasCapability: (capability: string) => capability === 'slack' && mocks.hasSlackCapability,
  }),
}));

vi.mock('@api/slack/slack.api.service', () => ({
  slackApiService: {
    getStatus: (...args: unknown[]) => mocks.getStatus(...args),
    getProjectChannelConfigs: (...args: unknown[]) => mocks.getProjectChannelConfigs(...args),
  },
}));

vi.mock('./IntegrationsDropdown', () => ({
  IntegrationsDropdown: () => <div>Integration settings</div>,
}));

describe('ProjectIntegrationsButton', () => {
  beforeEach(() => {
    mocks.capabilitiesLoaded = true;
    mocks.hasSlackCapability = false;
    mocks.getStatus.mockReset();
    mocks.getProjectChannelConfigs.mockReset();
    mocks.getStatus.mockResolvedValue({ connected: false });
    mocks.getProjectChannelConfigs.mockResolvedValue({ done: true, body: [] });
  });

  it('does not render or call Slack when the capability is unreleased', () => {
    const { container } = render(
      <ProjectIntegrationsButton projectId="project-1" projectName="Project" />
    );

    expect(container).toBeEmptyDOMElement();
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.getProjectChannelConfigs).not.toHaveBeenCalled();
  });

  it('loads Slack status only after the capability is enabled', async () => {
    mocks.hasSlackCapability = true;

    render(<ProjectIntegrationsButton projectId="project-1" projectName="Project" />);

    await waitFor(() => {
      expect(mocks.getStatus).toHaveBeenCalledTimes(1);
      expect(mocks.getProjectChannelConfigs).toHaveBeenCalledWith('project-1');
    });
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
