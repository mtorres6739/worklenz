import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Spin,
  Table,
  Tag,
  Typography,
} from '@/shared/antd-imports';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useGetRequestsQuery } from '@/api/client-portal/portal-client.api';

const ClientViewRequests = () => {
  const navigate = useNavigate();
  const { data, isLoading, error } = useGetRequestsQuery();

  if (isLoading) return <Spin size="large" />;
  if (error) return <Alert type="error" showIcon message="Requests could not be loaded" />;

  const requests = data?.requests || [];
  return (
    <Flex vertical gap={20} style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
        <div>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            Requests
          </Typography.Title>
          <Typography.Text type="secondary">
            Track work requested from the SDM team.
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate('/client-portal/requests/new')}
        >
          New request
        </Button>
      </Flex>
      <Card>
        {requests.length === 0 ? (
          <Empty description="No requests have been submitted yet." />
        ) : (
          <Table
            rowKey="id"
            dataSource={requests}
            pagination={{ pageSize: 20 }}
            onRow={record => ({
              onClick: () => navigate(`/client-portal/requests/${record.id}`),
              style: { cursor: 'pointer' },
            })}
            columns={[
              { title: 'Request', dataIndex: 'req_no', key: 'req_no' },
              { title: 'Service', dataIndex: 'service_name', key: 'service_name' },
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                render: status => (
                  <Tag color={status === 'completed' ? 'green' : 'blue'}>
                    {String(status).replaceAll('_', ' ')}
                  </Tag>
                ),
              },
              {
                title: 'Updated',
                dataIndex: 'updated_at',
                key: 'updated_at',
                render: value => new Date(value).toLocaleDateString(),
              },
            ]}
          />
        )}
      </Card>
    </Flex>
  );
};

export default ClientViewRequests;
