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
    requestNotifications: boolean;
    invoices: boolean;
    payments: boolean;
    stripeCheckout: boolean;
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

export interface PortalRequestAttachment {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  sender_type: 'client' | 'staff';
  created_at: string;
  can_delete?: boolean;
}

export interface PortalNotification {
  id: string;
  request_id?: string | null;
  req_no?: string | null;
  invoice_id?: string | null;
  invoice_no?: string | null;
  event_type:
    | 'request_created'
    | 'request_status_updated'
    | 'request_assigned'
    | 'request_comment_added'
    | 'request_attachment_added'
    | 'invoice_sent'
    | 'invoice_payment_pending'
    | 'invoice_paid'
    | 'invoice_payment_failed'
    | 'invoice_refunded';
  title: string;
  message: string;
  event_data: Record<string, unknown>;
  read_at?: string | null;
  created_at: string;
}

export interface PortalInvoice {
  id: string;
  invoiceNumber: string;
  amount: number;
  subtotal: number;
  discountType: 'none' | 'percentage' | 'fixed';
  discountValue: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  currency: string;
  status: 'sent' | 'payment_pending' | 'paid' | 'overdue' | 'cancelled';
  dueDate?: string | null;
  sentAt?: string | null;
  paidAt?: string | null;
  createdAt: string;
  updatedAt: string;
  requestNumber?: string | null;
  serviceName?: string | null;
  isOverdue?: boolean;
}

export interface PortalInvoiceDetails extends PortalInvoice {
  notes?: string | null;
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unitAmount: number;
    lineAmount: number;
    position: number;
  }>;
  client: {
    id: string;
    name: string;
    companyName?: string | null;
  };
  payments: Array<{
    provider: 'stripe' | 'manual';
    status: string;
    amount: number;
    currency: string;
    refunded_amount: number;
    provider_reference?: string | null;
    succeeded_at?: string | null;
    failed_at?: string | null;
    refunded_at?: string | null;
    created_at: string;
  }>;
}

export interface PortalPaymentSettings {
  manualEnabled: boolean;
  manualInstructions?: string | null;
  stripeEnabled: boolean;
}

const baseQuery = fetchBaseQuery({
  baseUrl: `${config.apiUrl}/api/client-portal`,
  credentials: 'include',
  prepareHeaders: headers => {
    const csrf = sessionStorage.getItem(CSRF_KEY);
    if (csrf) headers.set('X-Client-CSRF', csrf);
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
    'PortalRequestAttachments',
    'PortalNotifications',
    'PortalInvoices',
    'PortalPaymentSettings',
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
    getRequestAttachments: builder.query<
      { attachments: PortalRequestAttachment[]; total: number },
      string
    >({
      query: id => `/requests/${id}/attachments`,
      transformResponse: (
        response: ServerResponse<{
          attachments: PortalRequestAttachment[];
          total: number;
        }>
      ) => response.body,
      providesTags: (_result, _error, id) => [{ type: 'PortalRequestAttachments', id }],
    }),
    uploadRequestAttachment: builder.mutation<PortalRequestAttachment, { id: string; file: File }>({
      query: ({ id, file }) => {
        const body = new FormData();
        body.append('file', file);
        return {
          url: `/requests/${id}/attachments`,
          method: 'POST',
          body,
        };
      },
      transformResponse: (response: ServerResponse<PortalRequestAttachment>) => response.body,
      invalidatesTags: (_result, _error, { id }) => [{ type: 'PortalRequestAttachments', id }],
    }),
    downloadRequestAttachment: builder.mutation<
      { url: string; expires_in: number },
      { id: string; attachmentId: string }
    >({
      query: ({ id, attachmentId }) => ({
        url: `/requests/${id}/attachments/${attachmentId}/download`,
        method: 'GET',
      }),
      transformResponse: (response: ServerResponse<{ url: string; expires_in: number }>) =>
        response.body,
    }),
    deleteRequestAttachment: builder.mutation<{ id: string }, { id: string; attachmentId: string }>(
      {
        query: ({ id, attachmentId }) => ({
          url: `/requests/${id}/attachments/${attachmentId}`,
          method: 'DELETE',
        }),
        transformResponse: (response: ServerResponse<{ id: string }>) => response.body,
        invalidatesTags: (_result, _error, { id }) => [{ type: 'PortalRequestAttachments', id }],
      }
    ),
    getPortalNotifications: builder.query<
      { notifications: PortalNotification[]; total: number },
      void
    >({
      query: () => '/notifications',
      transformResponse: (
        response: ServerResponse<{ notifications: PortalNotification[]; total: number }>
      ) => response.body,
      providesTags: ['PortalNotifications'],
    }),
    getPortalNotificationUnreadCount: builder.query<number, void>({
      query: () => '/notifications/unread-count',
      transformResponse: (response: ServerResponse<number>) => response.body,
      providesTags: ['PortalNotifications'],
    }),
    markPortalNotificationRead: builder.mutation<
      { id: string; read_at: string },
      string
    >({
      query: id => ({
        url: `/notifications/${id}/read`,
        method: 'PUT',
      }),
      transformResponse: (
        response: ServerResponse<{ id: string; read_at: string }>
      ) => response.body,
      invalidatesTags: ['PortalNotifications'],
    }),
    markAllPortalNotificationsRead: builder.mutation<{ updated: number }, void>({
      query: () => ({
        url: '/notifications/read-all',
        method: 'PUT',
      }),
      transformResponse: (response: ServerResponse<{ updated: number }>) => response.body,
      invalidatesTags: ['PortalNotifications'],
    }),
    getPortalInvoices: builder.query<
      { invoices: PortalInvoice[]; total: number; page: number; limit: number },
      { page?: number; limit?: number; status?: string; search?: string } | void
    >({
      query: params => {
        const search = new URLSearchParams();
        if (params?.page) search.set('page', String(params.page));
        if (params?.limit) search.set('limit', String(params.limit));
        if (params?.status) search.set('status', params.status);
        if (params?.search) search.set('search', params.search);
        return `/invoices${search.size ? `?${search.toString()}` : ''}`;
      },
      transformResponse: (
        response: ServerResponse<{
          invoices: PortalInvoice[];
          total: number;
          page: number;
          limit: number;
        }>
      ) => response.body,
      providesTags: ['PortalInvoices'],
    }),
    getPortalInvoice: builder.query<PortalInvoiceDetails, string>({
      query: id => `/invoices/${id}`,
      transformResponse: (response: ServerResponse<PortalInvoiceDetails>) => response.body,
      providesTags: (_result, _error, id) => [{ type: 'PortalInvoices', id }],
    }),
    getPortalPaymentSettings: builder.query<PortalPaymentSettings, void>({
      query: () => '/invoices/payment-settings',
      transformResponse: (response: ServerResponse<PortalPaymentSettings>) => response.body,
      providesTags: ['PortalPaymentSettings'],
    }),
    createPortalInvoiceCheckout: builder.mutation<
      { checkoutUrl: string; sessionId: string },
      string
    >({
      query: id => ({
        url: `/invoices/${id}/checkout`,
        method: 'POST',
      }),
      transformResponse: (
        response: ServerResponse<{ checkoutUrl: string; sessionId: string }>
      ) => response.body,
      invalidatesTags: (_result, _error, id) => [
        { type: 'PortalInvoices', id },
        'PortalInvoices',
      ],
    }),
    submitPortalPaymentEvidence: builder.mutation<
      { id: string; status: string },
      { id: string; file: File }
    >({
      query: ({ id, file }) => {
        const body = new FormData();
        body.append('file', file);
        return {
          url: `/invoices/${id}/payment-evidence`,
          method: 'POST',
          body,
        };
      },
      transformResponse: (response: ServerResponse<{ id: string; status: string }>) =>
        response.body,
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'PortalInvoices', id },
        'PortalInvoices',
      ],
    }),
    downloadPortalInvoice: builder.mutation<Blob, string>({
      query: id => ({
        url: `/invoices/${id}/download`,
        method: 'GET',
        responseHandler: (response: Response) => response.blob(),
      }),
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
  useGetRequestAttachmentsQuery,
  useUploadRequestAttachmentMutation,
  useDownloadRequestAttachmentMutation,
  useDeleteRequestAttachmentMutation,
  useGetPortalNotificationsQuery,
  useGetPortalNotificationUnreadCountQuery,
  useMarkPortalNotificationReadMutation,
  useMarkAllPortalNotificationsReadMutation,
  useGetPortalInvoicesQuery,
  useGetPortalInvoiceQuery,
  useGetPortalPaymentSettingsQuery,
  useCreatePortalInvoiceCheckoutMutation,
  useSubmitPortalPaymentEvidenceMutation,
  useDownloadPortalInvoiceMutation,
} = portalClientApi;
