import { createBrowserRouter, Navigate, RouteObject } from 'react-router-dom';
import { lazy, Suspense, memo } from 'react';
import rootRoutes from './root-routes';
import authRoutes from './auth-routes';
import mainRoutes from './main-routes';
import notFoundRoute from './not-found-route';
import accountSetupRoute from './account-setup-routes';
import reportingRoutes from './reporting-routes';
import clientPortalRoutes from './client-portal-routes';
import { AuthenticatedLayout } from '@/layouts/AuthenticatedLayout';
import ErrorBoundary from '@/components/ErrorBoundary';
import { SuspenseFallback } from '@/components/suspense-fallback/suspense-fallback';
import ChunkErrorHandler from '@/utils/chunk-error-handler';

// Lazy load the NotFoundPage component for better code splitting
const NotFoundPage = lazy(
  ChunkErrorHandler.wrapLazyImport(() => import('@/pages/404-page/404-page'), 'NotFoundPage')
);

interface GuardProps {
  children: React.ReactNode;
}

// Route-based code splitting utility
const withCodeSplitting = (Component: React.LazyExoticComponent<React.ComponentType<any>>) => {
  return memo(() => (
    <Suspense fallback={<SuspenseFallback />}>
      <Component />
    </Suspense>
  ));
};

// Memoized guard components with defensive programming
import { useAuthStatus } from '@/hooks/useAuthStatus';
import clientViewRoutes from './client-view-routes';

export const AuthGuard = memo(({ children }: GuardProps) => {
  const { isAuthenticated, location } = useAuthStatus();

  if (!isAuthenticated) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <>{children}</>;
});

AuthGuard.displayName = 'AuthGuard';

export const AdminGuard = memo(({ children }: GuardProps) => {
  const { isAuthenticated, isAdmin, location } = useAuthStatus();

  if (!isAuthenticated) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/worklenz/unauthorized" />;
  }

  return <>{children}</>;
});

AdminGuard.displayName = 'AdminGuard';

export const SetupGuard = memo(({ children }: GuardProps) => {
  const { isAuthenticated, isSetupComplete, location } = useAuthStatus();

  if (!isAuthenticated) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (!isSetupComplete) {
    return <Navigate to="/worklenz/setup" />;
  }

  return <>{children}</>;
});

SetupGuard.displayName = 'SetupGuard';

// Combined guard for routes that require both authentication and setup completion
export const AuthAndSetupGuard = memo(({ children }: GuardProps) => {
  const { isAuthenticated, isSetupComplete, location } = useAuthStatus();

  if (!isAuthenticated) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (!isSetupComplete) {
    return <Navigate to="/worklenz/setup" />;
  }

  return <>{children}</>;
});

AuthAndSetupGuard.displayName = 'AuthAndSetupGuard';

// Optimized route wrapping function with Suspense boundaries
const wrapRoutes = (
  routes: RouteObject[],
  Guard: React.ComponentType<{ children: React.ReactNode }>
): RouteObject[] => {
  return routes.map(route => {
    const wrappedRoute = {
      ...route,
      element: (
        <Suspense fallback={<SuspenseFallback />}>
          <Guard>{route.element}</Guard>
        </Suspense>
      ),
    };

    if (route.children) {
      wrappedRoute.children = wrapRoutes(route.children, Guard);
    }

    if (route.index) {
      delete wrappedRoute.children;
    }

    return wrappedRoute;
  });
};

// Create route arrays.
const publicRoutes = [...rootRoutes, ...authRoutes, notFoundRoute];

// Apply combined guard to main routes that require both auth and setup completion
const protectedMainRoutes = wrapRoutes(mainRoutes, AuthAndSetupGuard);
const adminRoutes = wrapRoutes(reportingRoutes, AdminGuard);
const adminclientPortalRoutes = wrapRoutes(clientPortalRoutes, AdminGuard);
const setupRoutes = wrapRoutes([accountSetupRoute], AuthGuard);

// Create optimized router with future flags for better performance
const router = createBrowserRouter(
  [
    {
      element: (
        <ErrorBoundary>
          <AuthenticatedLayout />
        </ErrorBoundary>
      ),
      errorElement: (
        <ErrorBoundary>
          <Suspense fallback={<SuspenseFallback />}>
            <NotFoundPage />
          </Suspense>
        </ErrorBoundary>
      ),
      children: [
        ...protectedMainRoutes,
        ...adminRoutes,
        ...adminclientPortalRoutes,
        ...setupRoutes,
      ],
    },
    ...publicRoutes,
  ],
  {
    // Enable React Router future features for better performance
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  }
);

export default router;
