import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Col, ConfigProvider, Flex, Menu } from '@/shared/antd-imports';
import { createPortal } from 'react-dom';

import InviteTeamMembers from '../../components/common/invite-team-members/InviteTeamMembers';
import InviteButton from './invite/InviteButton';
import MobileMenuButton from './mobile-menu/MobileMenuButton';
import NavbarLogo from './NavbarLogo';
import NotificationButton from '../../components/navbar/notifications/notifications-drawer/notification/notification-button';
import ProfileButton from './user-profile/ProfileButton';
import SwitchTeamButton from './switch-team/SwitchTeamButton';
import NotificationDrawer from '../../components/navbar/notifications/notifications-drawer/notification/notfication-drawer';

import { useResponsive } from '@/hooks/useResponsive';
import { getJSONFromLocalStorage } from '@/utils/localStorageFunctions';
import { navRoutes, NavRoutesType } from './navRoutes';
import { useAuthService } from '@/hooks/useAuth';
import { authApiService } from '@/api/auth/auth.api.service';
import logger from '@/utils/errorLogger';
import TimerButton from './timers/TimerButton';
import { useMixpanelTracking } from '@/hooks/useMixpanelTracking';
import { useBusinessFeatures } from '@/worklenz-ee/hooks/use-business-features';
import { useAppDispatch } from '@/hooks/useAppDispatch';
import { useAppSelector } from '@/hooks/useAppSelector';
import { RootState } from '@/app/store';
import { fetchOrganizationDetails } from '@/features/admin-center/admin-center.slice';
import { isTeamLeadRole, ROLE_DEFINITIONS } from '@/types/roles/role.types';
import { ConnectionStatusIndicator } from '@/components/connection-status/ConnectionStatusIndicator';
import { getSessionRoleName } from '@/utils/role-permissions.utils';

const Navbar = () => {
  const dispatch = useAppDispatch();
  const [current, setCurrent] = useState<string>('home');

  const location = useLocation();
  const { isDesktop, isMobile, isTablet } = useResponsive();
  const { t } = useTranslation('navbar');

  // Get auth service and memoize derived values
  const authService = useAuthService();
  const currentSession = useMemo(() => authService.getCurrentSession(), [authService]);
  const { hasCapability } = useBusinessFeatures();
  const isOwnerOrAdmin = useMemo(() => authService.isOwnerOrAdmin(), [authService]);
  const currentRole = useMemo(() => getSessionRoleName(currentSession), [currentSession]);
  const canInviteMembers = ROLE_DEFINITIONS[currentRole].canInviteMembers;

  const { setIdentity, trackMixpanelEvent } = useMixpanelTracking();
  const [navRoutesList, setNavRoutesList] = useState<NavRoutesType[]>(navRoutes);
  const organization = useAppSelector((state: RootState) => state.adminCenterReducer.organization);

  useEffect(() => {
    authApiService
      .verify()
      .then(authorizeResponse => {
        if (authorizeResponse.authenticated) {
          authService.setCurrentSession(authorizeResponse.user);
          setIdentity(authorizeResponse.user);
        }
      })
      .catch(error => {
        logger.error('Error during authorization', error);
      });
  }, [authService, setIdentity]);

  // Fetch organization details for navbar logo if not already loaded
  useEffect(() => {
    if (currentSession && !organization && isOwnerOrAdmin) {
      dispatch(fetchOrganizationDetails());
    }
  }, [currentSession, organization, isOwnerOrAdmin, dispatch]);

  useEffect(() => {
    // Shared loader — used by all event sources below
    const loadNavRoutes = () => {
      const updated: NavRoutesType[] = getJSONFromLocalStorage('navRoutes') || navRoutes;
      setNavRoutesList(updated);
    };

    // Initial load
    loadNavRoutes();

    // Same-tab updates: fires when PinRouteToNavbarButton calls
    // window.dispatchEvent(new Event('navRoutesUpdated'))
    window.addEventListener('navRoutesUpdated', loadNavRoutes);

    // Cross-tab / testing environment updates: the native 'storage' event fires
    // automatically when localStorage is written from a DIFFERENT tab or context.
    // It does NOT fire in the same tab that wrote — that's covered by the custom
    // event above — so together these two cover every possible scenario.
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'navRoutes') loadNavRoutes();
    };
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('navRoutesUpdated', loadNavRoutes);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const navlinkItems = useMemo(() => {
    const isTeamLead = currentSession?.role_name ? isTeamLeadRole(currentSession.role_name) : false;

    return navRoutesList
      .filter(route => {
        if (route.adminOnly && !isOwnerOrAdmin) return false;
        if (route.teamLeadOnly && !isTeamLead) return false;
        if (route.capability && !hasCapability(route.capability)) return false;
        return true;
      })
      .map(route => {
        const defaultLabel = t(route.name);
        return {
          key: route.path.split('/').pop() || route.name,
          disabled: false,
          label: (
            <Link to={route.path} style={{ fontWeight: 600 }}>
              {defaultLabel}
            </Link>
          ),
        };
      });
  }, [navRoutesList, t, isOwnerOrAdmin, currentSession, hasCapability]);

  const currentRoute = useMemo(() => {
    const afterWorklenzString = location.pathname.split('/worklenz/')[1];
    const pathKey = afterWorklenzString?.split('/')[0];
    return pathKey ?? 'home';
  }, [location.pathname]);

  useEffect(() => {
    if (currentRoute !== current) {
      setCurrent(currentRoute);
    }
  }, [currentRoute, current]);

  const handleMenuClick = useCallback(
    (menuInfo: { key: string }) => {
      const { key } = menuInfo;
      const clickedRoute = navRoutesList.find(r => {
        const routeKey = r.path.split('/').pop() || r.name;
        return routeKey === key || r.name === key;
      });

      if (clickedRoute) {
        if (clickedRoute.name === 'client-portal') {
          trackMixpanelEvent('client_portal_nav_clicked', {
            source: 'navbar',
            user_type: 'self_hosted_full',
            is_admin: isOwnerOrAdmin,
          });
        }
      }
    },
    [navRoutesList, trackMixpanelEvent, isOwnerOrAdmin]
  );

  return (
    <Col
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        paddingInline: isDesktop ? 48 : 24,
        gap: 12,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Flex
        style={{
          width: '100%',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* logo */}
        <NavbarLogo />

        <Flex
          align="center"
          justify={isDesktop ? 'space-between' : 'flex-end'}
          style={{ width: '100%' }}
        >
          {isDesktop && (
            <Menu
              selectedKeys={[current]}
              mode="horizontal"
              style={{ flex: 10, maxWidth: 720, minWidth: 0, border: 'none' }}
              items={navlinkItems}
              onClick={handleMenuClick}
            />
          )}

          <Flex gap={20} align="center">
            <ConfigProvider wave={{ disabled: true }}>
              {isDesktop && (
                <Flex>
                  <Flex gap={20} align="center">
                    {canInviteMembers && <InviteButton />}
                    <Flex align="center">
                      <ConnectionStatusIndicator />
                      <SwitchTeamButton />
                      <NotificationButton />
                      <TimerButton />
                      {/* <HelpButton /> */}
                      <ProfileButton isOwnerOrAdmin={isOwnerOrAdmin} />
                    </Flex>
                  </Flex>
                </Flex>
              )}
              {isTablet && !isDesktop && (
                <Flex gap={12} align="center">
                  <SwitchTeamButton />
                  <NotificationButton />
                  <ProfileButton isOwnerOrAdmin={isOwnerOrAdmin} />
                  <MobileMenuButton />
                </Flex>
              )}
              {isMobile && (
                <Flex gap={12} align="center">
                  <NotificationButton />
                  <ProfileButton isOwnerOrAdmin={isOwnerOrAdmin} />
                  <MobileMenuButton />
                </Flex>
              )}
            </ConfigProvider>
          </Flex>
        </Flex>
      </Flex>

      {canInviteMembers &&
        createPortal(<InviteTeamMembers />, document.body, 'invite-team-members')}
      {createPortal(<NotificationDrawer />, document.body, 'notification-drawer')}
    </Col>
  );
};

export default memo(Navbar);
