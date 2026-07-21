import React, { lazy, Suspense } from 'react';
import { RouteObject } from 'react-router-dom';
import { Spin } from '@/shared/antd-imports';
import ClientPortalLayout from '@/layouts/client-portal-layout';
import ChunkErrorHandler from '@/utils/chunk-error-handler';

// Lazy load all client portal components with chunk error handling
const ClientPortalClients = lazy(
  ChunkErrorHandler.wrapLazyImport(
    () => import('@/pages/client-portal/clients/ClientPortalClients'),
    'ClientPortalClients'
  )
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
    ],
  },
];

export default clientPortalRoutes;
