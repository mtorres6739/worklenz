import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import Projects from './projects';

const mocks = vi.hoisted(() => ({
  deleteProject: vi.fn(),
  fetchProjects: vi.fn(),
  trackMixpanelEvent: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string) =>
      ({
        confirm: 'Delete project?',
        delete: 'Delete',
        deleteProject: 'Are you sure you want to delete this project?',
        refreshProjects: 'Refresh projects',
        search: 'Search',
      })[key] || key,
  }),
}));

vi.mock('@/hooks/useAppSelector', () => ({
  useAppSelector: () => 'light',
}));

vi.mock('@/hooks/useAppDispatch', () => ({
  useAppDispatch: () => vi.fn(),
}));

vi.mock('@/hooks/useDebouncedMediaQuery', () => ({
  useDebouncedMediaQuery: () => true,
}));

vi.mock('@/hooks/useMixpanelTracking', () => ({
  useMixpanelTracking: () => ({ trackMixpanelEvent: mocks.trackMixpanelEvent }),
}));

vi.mock('@/api/admin-center/admin-center.api.service', () => ({
  adminCenterApiService: {
    getOrganizationProjects: (...args: unknown[]) => mocks.fetchProjects(...args),
  },
}));

vi.mock('@/api/projects/projects.api.service', () => ({
  projectsApiService: {
    deleteProject: (...args: unknown[]) => mocks.deleteProject(...args),
  },
}));

describe('Admin Center project deletion', () => {
  const nativeGetComputedStyle = window.getComputedStyle;

  beforeAll(() => {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element =>
      nativeGetComputedStyle(element)
    );
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mocks.deleteProject.mockReset();
    mocks.deleteProject.mockResolvedValue({ done: true });
    mocks.fetchProjects.mockReset();
    mocks.fetchProjects.mockResolvedValue({
      done: true,
      body: {
        total: 1,
        data: [
          {
            id: 'project-1',
            name: 'Portal Pilot QA Project',
            team_name: 'SDM',
            member_count: 1,
            created_at: '2026-07-23T21:41:17.000Z',
          },
        ],
      },
    });
    mocks.trackMixpanelEvent.mockReset();
  });

  it('deletes the selected project after confirmation', async () => {
    const user = userEvent.setup();
    render(<Projects />);

    const projectName = await screen.findByText('Portal Pilot QA Project');
    const row = projectName.closest('tr');
    expect(row).not.toBeNull();

    await user.hover(row as HTMLElement);
    fireEvent.click(
      within(row as HTMLElement).getByRole('button', { name: 'Delete', hidden: true })
    );

    const confirmation = await screen.findByText('Are you sure you want to delete this project?');
    const popover = confirmation.closest('.ant-popover-inner');
    expect(popover).not.toBeNull();

    await user.click(within(popover as HTMLElement).getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(mocks.deleteProject).toHaveBeenCalledWith('project-1'));
  });
});
