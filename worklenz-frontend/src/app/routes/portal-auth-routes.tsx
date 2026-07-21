import { RouteObject } from 'react-router-dom';
import PortalInvite from '@/pages/client-view/auth/portal-invite';
import PortalLogin from '@/pages/client-view/auth/portal-login';
import PortalResetPassword from '@/pages/client-view/auth/portal-reset-password';

const portalAuthRoutes: RouteObject[] = [
  { path: '/portal/login', element: <PortalLogin /> },
  { path: '/portal/invite/:token', element: <PortalInvite /> },
  { path: '/portal/reset-password', element: <PortalResetPassword /> },
];

export default portalAuthRoutes;
