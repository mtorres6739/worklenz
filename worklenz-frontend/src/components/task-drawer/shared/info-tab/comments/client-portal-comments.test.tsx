import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ClientPortalComments from './client-portal-comments';

const mocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  query: vi.fn(),
  refetch: vi.fn(),
  socket: {
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('@/api/client-portal/client-portal-api', () => ({
  useGetClientPortalTaskCommentsQuery: (...args: unknown[]) => mocks.query(...args),
  useAddClientPortalTaskCommentMutation: () => [mocks.addComment, { isLoading: false }],
}));

vi.mock('@/socket/socketContext', () => ({
  useSocket: () => ({ socket: mocks.socket }),
}));

describe('ClientPortalComments', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.query.mockReturnValue({
      data: {
        body: {
          comments: [
            {
              id: 'comment-1',
              sender_type: 'client',
              sender_name: 'Portal QA Contact',
              comment: 'Client reply',
              created_at: '2026-07-23T00:00:00.000Z',
              updated_at: '2026-07-23T00:00:00.000Z',
            },
          ],
          total: 1,
        },
      },
      isLoading: false,
      error: undefined,
      refetch: mocks.refetch,
    });
    mocks.socket.on.mockReset();
    mocks.socket.off.mockReset();
  });

  it('refetches the client conversation whenever the staff drawer reopens', () => {
    render(<ClientPortalComments projectId="project-1" taskId="task-1" />);

    expect(mocks.query).toHaveBeenCalledWith(
      { projectId: 'project-1', taskId: 'task-1' },
      {
        skip: false,
        refetchOnMountOrArgChange: true,
      }
    );
    expect(screen.getByText('Client reply')).toBeInTheDocument();
  });
});
