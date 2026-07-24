import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import ClientSettingsDrawer from './ClientSettingsDrawer';

const mocks = vi.hoisted(() => ({
  assignProject: vi.fn(),
  refetchClientDetails: vi.fn(),
  refetchClientProjects: vi.fn(),
  removeProject: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: () => undefined }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../hooks/useAppSelector', () => ({
  useAppSelector: () => ({
    isClientSettingsDrawerOpen: true,
    selectedClientId: 'client-1',
  }),
}));

vi.mock('../../hooks/useAppDispatch', () => ({
  useAppDispatch: () => vi.fn(),
}));

vi.mock('../../api/projects/projects.v1.api.service', () => ({
  useGetProjectsQuery: () => ({
    data: { body: { data: [] } },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../../api/client-portal/client-portal-api', () => ({
  useGetClientDetailsQuery: () => ({
    data: {
      body: {
        id: 'client-1',
        name: 'Portal QA Client',
        projects: [
          {
            id: 'project-1',
            name: 'Portal QA Project',
            description: '',
            status: 'active',
            totalTasks: 0,
            completedTasks: 0,
            lastUpdated: '2026-07-23T00:00:00.000Z',
            members: [],
            access_level: 'view',
            can_view_files: false,
          },
        ],
      },
    },
    isLoading: false,
    refetch: mocks.refetchClientDetails,
  }),
  useGetClientProjectsQuery: () => ({
    refetch: mocks.refetchClientProjects,
  }),
  useAssignProjectToClientMutation: () => [mocks.assignProject, { isLoading: false }],
  useRemoveProjectFromClientMutation: () => [mocks.removeProject, { isLoading: false }],
}));

describe('ClientSettingsDrawer project access controls', () => {
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
    mocks.assignProject.mockReset();
    mocks.assignProject.mockReturnValue({ unwrap: () => Promise.resolve() });
    mocks.refetchClientDetails.mockReset();
    mocks.refetchClientDetails.mockResolvedValue(undefined);
    mocks.refetchClientProjects.mockReset();
    mocks.refetchClientProjects.mockResolvedValue(undefined);
    mocks.removeProject.mockReset();
    mocks.removeProject.mockReturnValue({ unwrap: () => Promise.resolve() });
  });

  it('updates comment and file permissions without opening the remove confirmation', async () => {
    const user = userEvent.setup();
    render(<ClientSettingsDrawer />);

    const accessSelect = screen.getAllByRole('combobox')[1];
    await user.click(accessSelect);
    await user.click(await screen.findByText('Can comment'));

    await waitFor(() =>
      expect(mocks.assignProject).toHaveBeenCalledWith({
        clientId: 'client-1',
        projectId: 'project-1',
        accessLevel: 'comment',
        canViewFiles: false,
      })
    );
    expect(
      screen.queryByText('Are you sure you want to remove this project from the client?')
    ).not.toBeInTheDocument();

    const showFiles = screen.getByRole('checkbox', { name: 'Show files' });
    fireEvent.click(showFiles);

    await waitFor(() =>
      expect(mocks.assignProject).toHaveBeenLastCalledWith({
        clientId: 'client-1',
        projectId: 'project-1',
        accessLevel: 'view',
        canViewFiles: true,
      })
    );
    expect(
      screen.queryByText('Are you sure you want to remove this project from the client?')
    ).not.toBeInTheDocument();
  });

  it('removes an assigned project after confirmation', async () => {
    const user = userEvent.setup();
    render(<ClientSettingsDrawer />);

    await user.click(screen.getByRole('button', { name: 'Remove Project' }));

    const confirmation = await screen.findByText(
      'Are you sure you want to remove this project from the client?'
    );
    const popover = confirmation.closest('.ant-popover-inner');
    expect(popover).not.toBeNull();

    await user.click(within(popover as HTMLElement).getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(mocks.removeProject).toHaveBeenCalledWith({
        clientId: 'client-1',
        projectId: 'project-1',
      })
    );
    expect(mocks.refetchClientProjects).toHaveBeenCalled();
  });
});
