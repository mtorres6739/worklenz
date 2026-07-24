import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Flex,
  Form,
  Input,
  Spin,
  Tag,
  Typography,
  message,
} from '@/shared/antd-imports';
import { ArrowLeftOutlined, SendOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useAddRequestCommentMutation,
  useGetRequestCommentsQuery,
  useGetRequestQuery,
} from '@/api/client-portal/portal-client.api';

const ClientViewRequestDetails = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const { data: request, isLoading, error } = useGetRequestQuery(id, { skip: !id });
  const { data: commentData } = useGetRequestCommentsQuery(id, { skip: !id });
  const [addComment, { isLoading: isAdding }] = useAddRequestCommentMutation();

  if (isLoading) return <Spin size="large" />;
  if (error || !request) return <Alert type="error" showIcon message="Request not found" />;

  return (
    <Flex vertical gap={18} style={{ width: '100%', maxWidth: 960 }}>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/client-portal/requests')}
        style={{ alignSelf: 'flex-start' }}
      >
        Back to requests
      </Button>
      <Flex justify="space-between" align="center" gap={12} wrap="wrap">
        <div>
          <Typography.Text type="secondary">{request.req_no}</Typography.Text>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {request.request_data?.title || request.service_name}
          </Typography.Title>
        </div>
        <Tag color={request.status === 'completed' ? 'green' : 'blue'}>
          {request.status.replaceAll('_', ' ')}
        </Tag>
      </Flex>
      <Card>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="Service">{request.service_name}</Descriptions.Item>
          <Descriptions.Item label="Submitted">
            {new Date(request.created_at).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="Description">
            <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {request.request_data?.description || request.notes || 'No description provided.'}
            </Typography.Paragraph>
          </Descriptions.Item>
          {request.assigned_to_name && (
            <Descriptions.Item label="Assigned to">{request.assigned_to_name}</Descriptions.Item>
          )}
        </Descriptions>
      </Card>
      <Card title="Conversation">
        <Flex vertical gap={14}>
          {(commentData?.comments || []).length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No comments yet." />
          ) : (
            commentData?.comments.map(comment => (
              <div key={comment.id}>
                <Flex justify="space-between" gap={12}>
                  <Typography.Text strong>{comment.sender_name}</Typography.Text>
                  <Typography.Text type="secondary">
                    {new Date(comment.created_at).toLocaleString()}
                  </Typography.Text>
                </Flex>
                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                  {comment.comment}
                </Typography.Paragraph>
              </div>
            ))
          )}
          <Form
            form={form}
            layout="vertical"
            onFinish={async values => {
              try {
                await addComment({ id, comment: values.comment }).unwrap();
                form.resetFields();
              } catch {
                message.error('Comment could not be added');
              }
            }}
          >
            <Form.Item
              name="comment"
              rules={[{ required: true, message: 'Enter a comment' }]}
              style={{ marginBottom: 10 }}
            >
              <Input.TextArea rows={3} maxLength={5000} showCount />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={isAdding}>
              Add comment
            </Button>
          </Form>
        </Flex>
      </Card>
    </Flex>
  );
};

export default ClientViewRequestDetails;
