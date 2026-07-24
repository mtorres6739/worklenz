import { Alert, Card, Empty, Flex, Spin, Tag, Typography } from '@/shared/antd-imports';
import { useNavigate } from 'react-router-dom';
import { useGetServicesQuery } from '@/api/client-portal/portal-client.api';

const ClientViewServices = () => {
  const navigate = useNavigate();
  const { data, isLoading, error } = useGetServicesQuery();

  if (isLoading) return <Spin size="large" />;
  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Services could not be loaded"
        description="Please refresh the page or contact your project manager."
      />
    );
  }

  const services = data?.services || [];
  return (
    <Flex vertical gap={24} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          Services
        </Typography.Title>
        <Typography.Text type="secondary">
          Submit a structured request to the SDM team.
        </Typography.Text>
      </div>
      {services.length === 0 ? (
        <Card style={{ width: '100%' }}>
          <Empty description="No services are available for this account yet." />
        </Card>
      ) : (
        <Flex gap={16} wrap="wrap">
          {services.map(service => (
            <Card
              key={service.id}
              hoverable
              style={{ width: 320 }}
              onClick={() => navigate(`/client-portal/services/${service.id}`)}
            >
              <Flex vertical gap={10}>
                <Flex justify="space-between" align="center">
                  <Tag color="blue">{service.category || 'Service'}</Tag>
                  {service.price !== null && service.price !== undefined && (
                    <Typography.Text strong>
                      {service.currency} {Number(service.price).toFixed(2)}
                    </Typography.Text>
                  )}
                </Flex>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {service.name}
                </Typography.Title>
                <Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }} style={{ margin: 0 }}>
                  {service.description ||
                    service.service_data?.description ||
                    'Request this service from the SDM team.'}
                </Typography.Paragraph>
              </Flex>
            </Card>
          ))}
        </Flex>
      )}
    </Flex>
  );
};

export default ClientViewServices;
