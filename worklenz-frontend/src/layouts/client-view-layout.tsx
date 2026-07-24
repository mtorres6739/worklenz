import { Button, Col, Flex, Layout, Typography } from '@/shared/antd-imports';
import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAppSelector } from '../hooks/useAppSelector';
import { useDebouncedMediaQuery } from '@/hooks/useDebouncedMediaQuery';
import ClientViewSiderMenu from '../pages/client-view/sidebar/client-view-sider-menu';
import { themeWiseColor } from '../utils/themeWiseColor';
import { LogoutOutlined } from '@ant-design/icons';
import {
  portalClientApi,
  useGetSessionQuery,
  useLogoutMutation,
} from '@/api/client-portal/portal-client.api';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { SOCKET_CONFIG } from '@/socket/config';
import { useAppDispatch } from '@/hooks/useAppDispatch';
import PortalNotificationsButton from '@/components/client-portal/PortalNotificationsButton';

const ClientViewLayout = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { data: session } = useGetSessionQuery();
  const [logout, { isLoading: isLoggingOut }] = useLogoutMutation();

  useEffect(() => {
    if (!session?.authenticated) return;
    const socket = io(SOCKET_CONFIG.url, {
      ...SOCKET_CONFIG.options,
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
    });
    socket.on(
      'portal:task-comment',
      (event: { projectId: string; taskId: string }) => {
        dispatch(
          portalClientApi.util.invalidateTags([
            { type: 'PortalComments', id: event.taskId },
            { type: 'PortalTasks', id: event.projectId },
            'PortalDashboard',
          ])
        );
      }
    );
    socket.on(
      'portal:request-event',
      (event: { requestId: string; eventType: string }) => {
        dispatch(
          portalClientApi.util.invalidateTags([
            'PortalRequests',
            'PortalDashboard',
            'PortalNotifications',
            { type: 'PortalRequests', id: event.requestId },
            { type: 'PortalRequestComments', id: event.requestId },
            { type: 'PortalRequestAttachments', id: event.requestId },
          ])
        );
      }
    );
    socket.on(
      'portal:invoice-event',
      (event: { invoiceId: string }) => {
        dispatch(
          portalClientApi.util.invalidateTags([
            'PortalInvoices',
            'PortalNotifications',
            { type: 'PortalInvoices', id: event.invoiceId },
          ])
        );
      }
    );
    return () => {
      socket.disconnect();
    };
  }, [dispatch, session?.authenticated]);

  // theme details from theme slice
  const themeMode = useAppSelector(state => state.themeReducer.mode);

  // useMediaQuery hook to check if the screen is desktop or not
  const isDesktop = useDebouncedMediaQuery({ query: '(min-width: 1024px)' });

  return (
    <Layout
      style={{
        minHeight: '100vh',
      }}
    >
      <Layout.Header
        className={`shadow-md ${themeMode === 'dark' ? '' : 'shadow-[#18181811]'}`}
        style={{
          zIndex: 999,
          position: 'fixed',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          padding: 0,
          borderBottom: themeMode === 'dark' ? '1px solid #303030' : '',
        }}
      >
        {session?.branding.logo_url ? (
          <img src={session.branding.logo_url} alt={session.branding.display_name} style={{ maxWidth: 150, maxHeight: 38, marginInlineStart: 24 }} />
        ) : (
          <Typography.Text strong style={{ marginInlineStart: 24, fontSize: 16 }}>
            {session?.branding.display_name || 'SDM Client Projects'}
          </Typography.Text>
        )}
        <Flex align="center" gap={8} style={{ marginInlineStart: 'auto', marginInlineEnd: 18 }}>
          {session?.capabilities.requestNotifications && <PortalNotificationsButton />}
          <Button
            type="text"
            icon={<LogoutOutlined />}
            loading={isLoggingOut}
            onClick={async () => {
              await logout().unwrap().catch(() => undefined);
              navigate('/portal/login', { replace: true });
            }}
          >
            Sign out
          </Button>
        </Flex>
      </Layout.Header>

      <Layout.Content>
        <Col
          style={{
            paddingInlineEnd: isDesktop ? 64 : 24,
            overflowX: 'hidden',
          }}
        >
          <Flex
            gap={24}
            align="flex-start"
            style={{
              width: '100%',
              marginBlockStart: 24,
            }}
          >
            <Flex
              style={{
                width: '100%',
                maxWidth: isCollapsed ? 56 : 240,
                minHeight: 'calc(100vh - 24px)',
                paddingBlockStart: 84,
                borderInlineEnd: `1px solid ${themeWiseColor('#f5f5f5', '#303030', themeMode)}`,
                transition: 'all 0.3s',
              }}
            >
              <ClientViewSiderMenu isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
            </Flex>

            <Flex style={{ width: '100%', marginBlockStart: 96 }}>
              <Outlet />
            </Flex>
          </Flex>
        </Col>
      </Layout.Content>
    </Layout>
  );
};

export default ClientViewLayout;
