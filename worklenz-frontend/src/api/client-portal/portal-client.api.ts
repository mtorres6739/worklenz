import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import config from '@/config/env';

const CSRF_KEY = 'worklenz.portal.csrf';

export interface PortalSession {
  authenticated: true;
  audience: 'client_portal';
  csrf_token: string;
  expires_at: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: 'admin' | 'member';
    access_level: 'view' | 'comment';
  };
  active: { membership_id: string; team_id: string; client_id: string };
  organizations: Array<{
    membership_id: string;
    team_id: string;
    client_id: string;
    client_name: string;
    organization_name: string;
    role: 'admin' | 'member';
    access_level: 'view' | 'comment';
  }>;
  branding: {
    display_name: string;
    accent_color: string;
    page_title: string;
    logo_url?: string | null;
    favicon_url?: string | null;
  };
  capabilities: {
    services: boolean;
    requests: boolean;
  };
}

interface ServerResponse<T> {
  done: boolean;
  body: T;
  message?: string | null;
}

export interface PortalProject {
  id: string;
  name: string;
  key: string;
  description?: string | null;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  updated_at: string;
  access_level: 'view' | 'comment';
  can_view_files: boolean;
  total_tasks: number;
  completed_tasks: number;
  members: Array<{ id: string; name: string; avatar_url?: string | null }>;
}

export interface PortalTask {
  id: string;
  name: string;
  description?: string | null;
  task_no: number;
  status: string;
  status_color: string;
  is_done: boolean;
  priority?: string | null;
  priority_color?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  parent_task_id?: string | null;
  portal_comment_count: number;
  assignees: Array<{ id: string; name: string; avatar_url?: string | null }>;
}

export interface PortalComment {
  id: string;
  sender_type: 'client' | 'staff';
  sender_name: string;
  comment: string;
  created_at: string;
  updated_at: string;
}

export interface PortalFile {
  id: string;
  name: string;
  size: number;
  type: string;
  source: 'project' | 'task';
  task_id?: string | null;
  created_at: string;
}

export interface PortalService {
  id: string;
  name: string;
  description?: string | null;
  service_key: string;
  service_data: {
    description?: string;
    request_form?: Array<{
      question: string;
      type: 'text' | 'multipleChoice' | 'attachment';
      answer?: string[];
      required?: boolean;
    }>;
  };
  price?: number | null;
  currency: string;
  category?: string | null;
  updated_at: string;
}

export interface PortalRequest {
  id: string;
  req_no: string;
  service_id: string;
  service_name: string;
  service_description?: string | null;
  status: string;
  request_data: Record<string, any>;
  notes?: string | null;
  assigned_to_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortalRequestComment {
  id: string;
  sender_type: 'client' | 'staff';
  sender_name: string;
  comment: string;
  created_at: string;
  updated_at: string;
}

const baseQuery = fetchBaseQuery({
  baseUrl: `${config.apiUrl}/api/client-portal`,
  credentials: 'include',
  prepareHeaders: headers => {
    const csrf = sessionStorage.getItem(CSRF_KEY);
    if (csrf) headers.set('X-Client-CSRF', csrf);
    headers.set('Content-Type', 'application/json');
    return headers;
  },
});

export const portalClientApi = createApi({
  reducerPath: 'portalClientApi',
  baseQuery: async (args, api, extraOptions) => {
    const result = await baseQuery(args, api, extraOptions);
    if (result.error?.status === 401) sessionStorage.removeItem(CSRF_KEY);
    return result;
  },
  tagTypes: [
    'PortalSession',
    'PortalDashboard',
    'PortalProjects',
    'PortalTasks',
    'PortalComments',
    'PortalFiles',
    'PortalServices',
    'PortalRequests',
    'PortalRequestComments',
  ],
  endpoints: builder => ({
    getSession: builder.query<PortalSession, void>({
      query: () => '/auth/session',
      transformResponse: (response: ServerResponse<PortalSession>) => {
        sessionStorage.setItem(CSRF_KEY, response.body.csrf_token);
        return response.body;
      },
      providesTags: ['PortalSession'],
    }),
    login: builder.mutation<PortalSession, { email: string; password: string }>({
      query: body => ({ url: '/auth/login', method: 'POST', body }),
      transformResponse: (response: ServerResponse<PortalSession>) => {
        sessionStorage.setItem(CSRF_KEY, response.body.csrf_token);
        return response.body;
      },
      invalidatesTags: ['PortalSession'],
    }),
    logout: builder.mutation<void, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      transformResponse: () => {
        sessionStorage.removeItem(CSRF_KEY);
      },
      invalidatesTags: ['PortalSession'],
    }),
    getInvitation: builder.query<any, string>({
      query: token => `/invitation/${encodeURIComponent(token)}`,
      transformResponse: (response: ServerResponse<any>) => response.body,
    }),
    acceptInvitation: builder.mutation<
      PortalSession,
      { token: string; name: string; password: string }
    >({
      query: ({ token, ...body }) => ({
        url: `/invitation/${encodeURIComponent(token)}/accept`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: ServerResponse<PortalSession>) => {
        sessionStorage.setItem(CSRF_KEY, response.body.csrf_token);
        return response.body;
      },
      invalidatesTags: ['PortalSession'],
    }),
    requestPasswordReset: builder.mutation<void, { email: string }>({
      query: body => ({ url: '/auth/request-reset', method: 'POST', body }),
    }),
    resetPassword: builder.mutation<void, { token: string; password: string }>({
      query: body => ({ url: '/auth/reset', method: 'POST', body }),
    }),
    getDashboard: builder.query<any, void>({
      query: () => '/dashboard',
      transformResponse: (response: ServerResponse<any>) => response.body,
      providesTags: ['PortalDashboard'],
    }),
    getProjects: builder.query<{ projects: PortalProject[]; total: number }, void>({
      query: () => '/projects',
      transformResponse: (response: ServerResponse<{ projects: PortalProject[]; total: number }>) =>
        response.body,
      providesTags: ['PortalProjects'],
    }),
    getProject: builder.query<PortalProject, string>({
      query: projectId => `/projects/${projectId}`,
      transformResponse: (response: ServerResponse<PortalProject>) => response.body,
      providesTags: (_result, _error, id) => [{ type: 'PortalProjects', id }],
    }),
    getTasks: builder.query<{ tasks: PortalTask[]; total: number }, string>({
      query: projectId => `/projects/${projectId}/tasks`,
      transformResponse: (response: ServerResponse<{ tasks: PortalTask[]; total: number }>) =>
        response.body,
      providesTags: (_result, _error, id) => [{ type: 'PortalTasks', id }],
    }),
    getComments: builder.query<
      { comments: PortalComment[]; total: number },
      { projectId: string; taskId: string }
    >({
      query: ({ projectId, taskId }) => `/projects/${projectId}/tasks/${taskId}/comments`,
      transformResponse: (response: ServerResponse<{ comments: PortalComment[]; total: number }>) =>
        response.body,
      providesTags: (_result, _error, { taskId }) => [{ type: 'PortalComments', id: taskId }],
    }),
    addComment: builder.mutation<
      PortalComment,
      { projectId: string; taskId: string; comment: string }
    >({
      query: ({ projectId, taskId, comment }) => ({
        url: `/projects/${projectId}/tasks/${taskId}/comments`,
        method: 'POST',
        body: { comment },
      }),
      transformResponse: (response: ServerResponse<PortalComment>) => response.body,
      invalidatesTags: (_result, _error, { taskId }) => [{ type: 'PortalComments', id: taskId }],
    }),
    getFiles: builder.query<{ files: PortalFile[]; total: number }, string>({
      query: projectId => `/projects/${projectId}/files`,
      transformResponse: (response: ServerResponse<{ files: PortalFile[]; total: number }>) =>
        response.body,
      providesTags: (_result, _error, id) => [{ type: 'PortalFiles', id }],
    }),
    downloadFile: builder.mutation<
      { url: string; expires_in: number },
      { projectId: string; fileId: string; source: 'project' | 'task' }
    >({
      query: ({ projectId, fileId, source }) => ({
        url: `/projects/${projectId}/files/${fileId}/download?source=${source}`,
        method: 'GET',
      }),
      transformResponse: (response: ServerResponse<{ url: string; expires_in: number }>) =>
        response.body,
    }),
    getServices: builder.query<{ services: PortalService[]; total: number }, void>({
      query: () => '/services',
      transformResponse: (response: ServerResponse<{ services: PortalService[]; total: number }>) =>
        response.body,
      providesTags: ['PortalServices'],
    }),
    getService: builder.query<PortalService, string>({
      query: id => `/services/${id}`,
      transformResponse: (response: ServerResponse<PortalService>) => response.body,
      providesTags: (_result, _error, id) => [{ type: 'PortalServices', id }],
    }),
    getRequests: builder.query<
      { requests: PortalRequest[]; total: number; page: number; limit: number },
      void
    >({
      query: () => '/requests',
      transformResponse: (
        response: ServerResponse<{
          requests: PortalRequest[];
          total: number;
          page: number;
          limit: number;
        }>
      ) => response.body,
      providesTags: ['PortalRequests'],
    }),
    createRequest: builder.mutation<
      PortalRequest,
      { service_id: string; request_data: Record<string, unknown>; notes?: string }
    >({
      query: body => ({ url: '/requests', method: 'POST', body }),
      transformResponse: (response: ServerResponse<PortalRequest>) => response.body,
      invalidatesTags: ['PortalRequests', 'PortalDashboard'],
    }),
    getRequest: builder.query<PortalRequest, string>({
      query: id => `/requests/${id}`,
      transformResponse: (response: ServerResponse<PortalRequest>) => response.body,
      providesTags: (_result, _error, id) => [{ type: 'PortalRequests', id }],
    }),
    getRequestComments: builder.query<{ comments: PortalRequestComment[]; total: number }, string>({
      query: id => `/requests/${id}/comments`,
      transformResponse: (
        response: ServerResponse<{ comments: PortalRequestComment[]; total: number }>
      ) => response.body,
      providesTags: (_result, _error, id) => [{ type: 'PortalRequestComments', id }],
    }),
    addRequestComment: builder.mutation<PortalRequestComment, { id: string; comment: string }>({
      query: ({ id, comment }) => ({
        url: `/requests/${id}/comments`,
        method: 'POST',
        body: { comment },
      }),
      transformResponse: (response: ServerResponse<PortalRequestComment>) => response.body,
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'PortalRequestComments', id },
        { type: 'PortalRequests', id },
      ],
    }),
  }),
});

export const {
  useGetSessionQuery,
  useLoginMutation,
  useLogoutMutation,
  useGetInvitationQuery,
  useAcceptInvitationMutation,
  useRequestPasswordResetMutation,
  useResetPasswordMutation,
  useGetDashboardQuery,
  useGetProjectsQuery,
  useGetProjectQuery,
  useGetTasksQuery,
  useGetCommentsQuery,
  useAddCommentMutation,
  useGetFilesQuery,
  useDownloadFileMutation,
  useGetServicesQuery,
  useGetServiceQuery,
  useGetRequestsQuery,
  useCreateRequestMutation,
  useGetRequestQuery,
  useGetRequestCommentsQuery,
  useAddRequestCommentMutation,
} = portalClientApi;
