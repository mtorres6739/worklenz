import { BellOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

import {
  useGetPortalNotificationsQuery,
  useGetPortalNotificationUnreadCountQuery,
  useMarkAllPortalNotificationsReadMutation,
  useMarkPortalNotificationReadMutation,
} from '@/api/client-portal/portal-client.api';
import {
  Badge,
  Button,
  Empty,
  Flex,
  Popover,
  Spin,
  Typography,
} from '@/shared/antd-imports';

const PortalNotificationsButton = () => {
  const navigate = useNavigate();
  const { data, isLoading } = useGetPortalNotificationsQuery();
  const { data: unreadCount = 0 } = useGetPortalNotificationUnreadCountQuery();
  const [markRead] = useMarkPortalNotificationReadMutation();
  const [markAllRead, { isLoading: isMarkingAll }] =
    useMarkAllPortalNotificationsReadMutation();
  const notifications = data?.notifications || [];

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      content={
        <Flex vertical gap={10} style={{ width: 340, maxWidth: '80vw' }}>
          <Flex justify="space-between" align="center">
            <Typography.Text strong>Notifications</Typography.Text>
            {unreadCount > 0 && (
              <Button
                type="link"
                size="small"
                loading={isMarkingAll}
                onClick={() => void markAllRead()}
              >
                Mark all read
              </Button>
            )}
          </Flex>
          {isLoading ? (
            <Spin />
          ) : notifications.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No notifications yet." />
          ) : (
            <Flex vertical style={{ maxHeight: 420, overflowY: 'auto' }}>
              {notifications.map(notification => (
                <Button
                  key={notification.id}
                  type="text"
                  block
                  style={{
                    height: 'auto',
                    padding: 12,
                    textAlign: 'left',
                    background: notification.read_at ? undefined : 'rgba(22, 119, 255, 0.08)',
                  }}
                  onClick={async () => {
                    if (!notification.read_at) {
                      await markRead(notification.id).unwrap().catch(() => undefined);
                    }
                    navigate(`/client-portal/requests/${notification.request_id}`);
                  }}
                >
                  <Flex vertical gap={2} style={{ width: '100%' }}>
                    <Flex justify="space-between" gap={10}>
                      <Typography.Text strong={!notification.read_at}>
                        {notification.title}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {new Date(notification.created_at).toLocaleDateString()}
                      </Typography.Text>
                    </Flex>
                    <Typography.Text type="secondary" style={{ whiteSpace: 'normal' }}>
                      {notification.message}
                    </Typography.Text>
                  </Flex>
                </Button>
              ))}
            </Flex>
          )}
        </Flex>
      }
    >
      <Badge count={unreadCount} size="small" overflowCount={99}>
        <Button type="text" aria-label="Client Portal notifications" icon={<BellOutlined />} />
      </Badge>
    </Popover>
  );
};

export default PortalNotificationsButton;
