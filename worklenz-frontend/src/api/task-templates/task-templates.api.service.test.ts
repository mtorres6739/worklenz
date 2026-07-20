import { describe, expect, it } from 'vitest';

import { buildTemplateTasksPayload } from './task-templates.api.service';
import type { IProjectTask } from '@/types/project/projectTasksViewModel.types';

describe('buildTemplateTasksPayload', () => {
  it('preserves stable keys, descriptions, labels, estimates, and hierarchy', () => {
    const projectTasks = [
      {
        id: 'parent-id',
        name: 'Parent task',
        description: 'Parent acceptance criteria',
        total_minutes: 90,
        labels: [{ name: 'Launch Blocker', color_code: '#ff4d4f' }],
        sub_tasks: [
          {
            id: 'child-id',
            name: 'Child task',
            description: 'Child acceptance criteria',
            total_minutes: 30,
            labels: [{ name: 'Conditional', color_code: '#722ed1' }],
            sub_tasks: [
              {
                id: 'grandchild-id',
                name: 'Grandchild task',
                description: 'Grandchild acceptance criteria',
                total_minutes: 15,
                labels: [],
              },
            ],
          },
        ],
      },
    ] as unknown as IProjectTask[];

    expect(buildTemplateTasksPayload(projectTasks, true)).toEqual([
      {
        key: 'parent-id',
        name: 'Parent task',
        description: 'Parent acceptance criteria',
        total_minutes: 90,
        labels: [{ name: 'Launch Blocker', color_code: '#ff4d4f' }],
        sub_tasks: [
          {
            key: 'child-id',
            name: 'Child task',
            description: 'Child acceptance criteria',
            total_minutes: 30,
            labels: [{ name: 'Conditional', color_code: '#722ed1' }],
            sub_tasks: [
              {
                key: 'grandchild-id',
                name: 'Grandchild task',
                description: 'Grandchild acceptance criteria',
                total_minutes: 15,
                labels: [],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('keeps legacy templates compatible when subtasks are excluded', () => {
    const projectTasks = [{ id: 'legacy-id', name: 'Legacy task', labels: [] }] as unknown as IProjectTask[];

    expect(buildTemplateTasksPayload(projectTasks, false)).toEqual([
      {
        key: 'legacy-id',
        name: 'Legacy task',
        description: null,
        total_minutes: 0,
        labels: [],
      },
    ]);
  });
});
