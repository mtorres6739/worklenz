import ClientViewLayout from '@/layouts/client-view-layout';
import ClientViewDashboard from '@/pages/client-view/dashboard/client-view-dashboard';
import ClientViewProjects from '@/pages/client-view/projects/client-view-projects';
import ClientViewProjectDetails from '@/pages/client-view/projects/project-details/client-view-project-details';
import ClientViewServices from '@/pages/client-view/services/client-view-service';
import ClientViewServiceDetails from '@/pages/client-view/services/service-details/client-view-service-details';
import ClientViewRequests from '@/pages/client-view/requests/client-view-requests';
import NewRequestForm from '@/pages/client-view/requests/new-request-form';
import ClientViewRequestDetails from '@/pages/client-view/requests/request-details/client-view-request-details';
import ClientViewInvoices from '@/pages/client-view/invoices/client-view-invoices';
import ClientViewInvoiceDetails from '@/pages/client-view/invoices/invoice-details/client-view-invoice-details';
import { useGetSessionQuery } from '@/api/client-portal/portal-client.api';
import { Navigate, RouteObject } from 'react-router-dom';
import type { ReactNode } from 'react';

function PortalCapabilityRoute({
  capability,
  children,
}: {
  capability: 'services' | 'requests' | 'invoices';
  children: ReactNode;
}) {
  const { data: session, isLoading } = useGetSessionQuery();
  if (isLoading) return null;
  return session?.capabilities[capability] ? children : <Navigate to="/client-portal/dashboard" />;
}

const clientViewRoutes: RouteObject[] = [
  {
    path: 'client-portal',
    element: <ClientViewLayout />,
    children: [
      {
        index: true,
        element: <ClientViewDashboard />,
      },
      {
        path: 'dashboard',
        element: <ClientViewDashboard />,
      },
      {
        path: 'projects',
        element: <ClientViewProjects />,
      },
      {
        path: 'projects/:id',
        element: <ClientViewProjectDetails />,
      },
      {
        path: 'services',
        element: (
          <PortalCapabilityRoute capability="services">
            <ClientViewServices />
          </PortalCapabilityRoute>
        ),
      },
      {
        path: 'services/:id',
        element: (
          <PortalCapabilityRoute capability="services">
            <ClientViewServiceDetails />
          </PortalCapabilityRoute>
        ),
      },
      {
        path: 'requests',
        element: (
          <PortalCapabilityRoute capability="requests">
            <ClientViewRequests />
          </PortalCapabilityRoute>
        ),
      },
      {
        path: 'requests/new',
        element: (
          <PortalCapabilityRoute capability="requests">
            <NewRequestForm />
          </PortalCapabilityRoute>
        ),
      },
      {
        path: 'requests/:id',
        element: (
          <PortalCapabilityRoute capability="requests">
            <ClientViewRequestDetails />
          </PortalCapabilityRoute>
        ),
      },
      {
        path: 'invoices',
        element: (
          <PortalCapabilityRoute capability="invoices">
            <ClientViewInvoices />
          </PortalCapabilityRoute>
        ),
      },
      {
        path: 'invoices/:id',
        element: (
          <PortalCapabilityRoute capability="invoices">
            <ClientViewInvoiceDetails />
          </PortalCapabilityRoute>
        ),
      },
    ],
  },
];

export default clientViewRoutes;
