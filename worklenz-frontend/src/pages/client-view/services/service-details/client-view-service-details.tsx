import { Alert, Button, Card, Flex, Spin, Tag, Typography } from '@/shared/antd-imports';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useGetServiceQuery } from '@/api/client-portal/portal-client.api';

const ClientViewServiceDetails = () => {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { data: service, isLoading, error } = useGetServiceQuery(id, { skip: !id });

  if (isLoading) return <Spin size="large" />;
  if (error || !service) {
    return <Alert type="error" showIcon message="Service not found" />;
  }

  return (
    <Flex vertical gap={20} style={{ width: '100%', maxWidth: 900 }}>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/client-portal/services')}
        style={{ alignSelf: 'flex-start' }}
      >
        Back to services
      </Button>
      <Card>
        <Flex vertical gap={18}>
          <Flex justify="space-between" align="flex-start" gap={16} wrap="wrap">
            <div>
              <Tag color="blue">{service.category || 'Service'}</Tag>
              <Typography.Title level={2} style={{ marginTop: 10, marginBottom: 0 }}>
                {service.name}
              </Typography.Title>
            </div>
            {service.price !== null && service.price !== undefined && (
              <Typography.Title level={4} style={{ margin: 0 }}>
                {service.currency} {Number(service.price).toFixed(2)}
              </Typography.Title>
            )}
          </Flex>
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 16 }}>
            {service.description || service.service_data?.description || 'No description provided.'}
          </Typography.Paragraph>
          <Button
            type="primary"
            size="large"
            onClick={() =>
              navigate(`/client-portal/requests/new?serviceId=${encodeURIComponent(service.id)}`)
            }
            style={{ alignSelf: 'flex-start' }}
          >
            Request this service
          </Button>
        </Flex>
      </Card>
    </Flex>
  );
};

export default ClientViewServiceDetails;
