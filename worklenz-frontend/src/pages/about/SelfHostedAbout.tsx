import { Card, Flex, Typography } from '@/shared/antd-imports';
import { useAuthService } from '@/hooks/useAuth';

const SOURCE_URL = 'https://github.com/mtorres6739/worklenz';
const LICENSE_URL = `${SOURCE_URL}/blob/main/LICENSE`;

const SelfHostedAbout = () => {
  const authService = useAuthService();
  const version = authService.getCurrentSession()?.build_v || 'development';

  return (
    <Flex justify="center" style={{ paddingBlock: 48 }}>
      <Card style={{ width: '100%', maxWidth: 680 }}>
        <Flex vertical gap={16}>
          <div>
            <Typography.Title level={2} style={{ marginBottom: 4 }}>
              SDM Self-Hosted
            </Typography.Title>
            <Typography.Text type="secondary">Worklenz Community Edition</Typography.Text>
          </div>

          <Typography.Paragraph>
            This deployment is operated by Strategic Digital Marketing. Commercial subscription
            limits are not used; role permissions, tenant isolation, and security controls remain
            enforced.
          </Typography.Paragraph>

          <div>
            <Typography.Text strong>Deployment version</Typography.Text>
            <Typography.Paragraph copyable={{ text: version }} code style={{ marginTop: 6 }}>
              {version}
            </Typography.Paragraph>
          </div>

          <Typography.Paragraph style={{ marginBottom: 0 }}>
            Worklenz and this modified corresponding source are licensed under AGPL-3.0.{' '}
            <a href={SOURCE_URL} target="_blank" rel="noreferrer">
              View corresponding source
            </a>{' '}
            or{' '}
            <a href={LICENSE_URL} target="_blank" rel="noreferrer">
              read the license
            </a>
            .
          </Typography.Paragraph>
        </Flex>
      </Card>
    </Flex>
  );
};

export default SelfHostedAbout;
