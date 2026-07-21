import { UserOutlined } from '@/shared/antd-imports';
import {
  Button,
  Card,
  Dropdown,
  Flex,
  MenuProps,
  Tooltip,
  Typography,
} from '@/shared/antd-imports';

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { memo, useState } from 'react';
import MobileAppModal from '@/components/mobile-app/MobileAppModal';

import { useAppSelector } from '@/hooks/useAppSelector';
import { RootState } from '@/app/store';

import { getRole } from '@/utils/session-helper';

import './profile-dropdown.css';
import './profile-button.css';
import SingleAvatar from '@/components/common/single-avatar/single-avatar';

interface ProfileButtonProps {
  isOwnerOrAdmin: boolean;
}

const ProfileButton = ({ isOwnerOrAdmin }: ProfileButtonProps) => {
  const { t } = useTranslation('navbar');
  const currentSession = useAppSelector((state: RootState) => state.userReducer);

  const role = getRole();
  const themeMode = useAppSelector((state: RootState) => state.themeReducer.mode);
  const [mobileModalOpen, setMobileModalOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const getLinkStyle = () => ({
    color: themeMode === 'dark' ? '#ffffffd9' : '#181818',
  });

  const profile: MenuProps['items'] = [
    {
      key: '1',
      label: (
        <Card
          className={`profile-card ${themeMode === 'dark' ? 'dark' : ''}`}
          title={
            <div style={{ paddingBlock: '16px' }}>
              <Typography.Text>Account</Typography.Text>
              <Flex gap={8} align="center" justify="flex-start" style={{ width: '100%' }}>
                <SingleAvatar
                  avatarUrl={currentSession?.avatar_url}
                  name={currentSession?.name}
                  email={currentSession?.email}
                />
                <Flex vertical style={{ flex: 1, minWidth: 0 }}>
                  <Typography.Text
                    ellipsis={{ tooltip: currentSession?.name }} // Show tooltip on hover
                    style={{
                      width: '100%',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {currentSession?.name}
                  </Typography.Text>
                  <Typography.Text
                    ellipsis={{ tooltip: currentSession?.email }} // Show tooltip on hover
                    style={{
                      fontSize: 12,
                      width: '100%',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {currentSession?.email}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    ({role})
                  </Typography.Text>
                  <Typography.Text style={{ fontSize: 11, color: '#1677ff' }}>
                    SDM Self-Hosted
                  </Typography.Text>
                  <Typography.Text
                    type="secondary"
                    ellipsis={{ tooltip: currentSession?.build_v }}
                    style={{ fontSize: 10, maxWidth: 160 }}
                  >
                    {currentSession?.build_v || 'development'}
                  </Typography.Text>
                </Flex>
              </Flex>
            </div>
          }
          variant="borderless"
          style={{ width: 230 }}
        >
          {isOwnerOrAdmin && (
            <Link to="/worklenz/admin-center/overview" style={getLinkStyle()}>
              {t('adminCenter')}
            </Link>
          )}
          <Link to="/worklenz/settings/profile" style={getLinkStyle()}>
            {t('settings')}
          </Link>
          <Link to="/worklenz/about" style={getLinkStyle()}>
            About SDM Self-Hosted
          </Link>
          <div
            onClick={() => {
              setMobileModalOpen(true);
              setDropdownOpen(false);
            }}
            style={{
              ...getLinkStyle(),
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: 700,
            }}
          >
            {t('getMobileApp')}
          </div>
          <Link to="/auth/logging-out" style={getLinkStyle()}>
            {t('logOut')}
          </Link>
        </Card>
      ),
    },
  ];

  return (
    <>
      <Dropdown
        overlayClassName="profile-dropdown"
        menu={{ items: profile }}
        placement="bottomRight"
        trigger={['click']}
        open={dropdownOpen}
        onOpenChange={setDropdownOpen}
      >
        <Tooltip title={t('profileTooltip')}>
          <Button
            className="profile-button"
            style={{ height: '62px', width: '60px' }}
            type="text"
            icon={
              currentSession?.avatar_url ? (
                <SingleAvatar
                  avatarUrl={currentSession.avatar_url}
                  name={currentSession.name}
                  email={currentSession.email}
                />
              ) : (
                <UserOutlined style={{ fontSize: 20 }} />
              )
            }
          />
        </Tooltip>
      </Dropdown>

      <MobileAppModal open={mobileModalOpen} onClose={() => setMobileModalOpen(false)} />
    </>
  );
};

export default memo(ProfileButton);
