import React, { lazy, Suspense } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';
import { Spin } from '@/shared/antd-imports';
import ClientPortalLayout from '@/layouts/client-portal-layout';
import ChunkErrorHandler from '@/utils/chunk-error-handler';
import { useBusinessFeatures } from '@/worklenz-ee/hooks/use-business-features';
import type { SelfHostedCapabilityKey } from '@/worklenz-ee/types/business-features.types';

// Lazy load all client portal components with chunk error handling
const ClientPortalClients = lazy(
  ChunkErrorHandler.wrapLazyImport(
    () => import('@/pages/client-portal/clients/ClientPortalClients'),
    'ClientPortalClients'
  )
);
const ClientPortalServices = lazy(
  ChunkErrorHandler.wrapLazyImport(
    () => import('@/pages/client-portal/services/client-portal-services'),
    'ClientPortalServices'
  )
);
const ClientPortalAddServices = lazy(
  ChunkErrorHandler.wrapLazyImport(
    () => import('@/pages/client-portal/services/add-service/ClientPortalAddServices'),
    'ClientPortalAddServices'
  )
);
const ClientPortalEditService = lazy(
  ChunkErrorHandler.wrapLazyImport(
    () => import('@/pages/client-portal/services/edit-service/client-portal-edit-service'),
    'ClientPortalEditService'
  )
);
const ClientPortalRequests = lazy(
  ChunkErrorHandler.wrapLazyImport(
    () => import('@/pages/client-portal/requests/client-portal-requests'),
    'ClientPortalRequests'
  )
);
const ClientPortalRequestDetails = lazy(
  ChunkErrorHandler.wrapLazyImport(
    () => import('@/pages/client-portal/requests/request-details/client-portal-request-details'),
    'ClientPortalRequestDetails'
  )
);

const loading = <Spin size="large" style={{ display: 'block', margin: '50px auto' }} />;

function CapabilityRoute({
  capability,
  children,
}: {
  capability: SelfHostedCapabilityKey;
  children: React.ReactNode;
}) {
  const { hasCapability, capabilitiesLoaded } = useBusinessFeatures();
  if (!capabilitiesLoaded) return loading;
  return hasCapability(capability) ? children : <Navigate to="/worklenz/client-portal/clients" />;
}

const guarded = (capability: SelfHostedCapabilityKey, element: React.ReactNode) => (
  <CapabilityRoute capability={capability}>
    <Suspense fallback={loading}>{element}</Suspense>
  </CapabilityRoute>
);

const clientPortalRoutes: RouteObject[] = [
  {
    path: 'worklenz/client-portal',
    element: <ClientPortalLayout />,
    children: [
      {
        path: 'clients',
        element: (
          <Suspense
            fallback={<Spin size="large" style={{ display: 'block', margin: '50px auto' }} />}
          >
            <ClientPortalClients />
          </Suspense>
        ),
      },
      {
        path: 'services',
        element: guarded('clientPortalServices', <ClientPortalServices />),
      },
      {
        path: 'add-service',
        element: guarded('clientPortalServices', <ClientPortalAddServices />),
      },
      {
        path: 'edit-service/:id',
        element: guarded('clientPortalServices', <ClientPortalEditService />),
      },
      {
        path: 'requests',
        element: guarded('clientPortalRequests', <ClientPortalRequests />),
      },
      {
        path: 'requests/:id',
        element: guarded('clientPortalRequests', <ClientPortalRequestDetails />),
      },
    ],
  },
];

export default clientPortalRoutes;
