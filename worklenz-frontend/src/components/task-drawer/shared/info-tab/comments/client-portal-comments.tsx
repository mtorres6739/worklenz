import {
  Alert,
  Avatar,
  Button,
  Empty,
  Flex,
  Input,
  List,
  Tag,
  Typography,
  message,
} from '@/shared/antd-imports';
import { CustomerServiceOutlined, SendOutlined, TeamOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import {
  useAddClientPortalTaskCommentMutation,
  useGetClientPortalTaskCommentsQuery,
} from '@/api/client-portal/client-portal-api';
import { useSocket } from '@/socket/socketContext';

interface ClientPortalCommentsProps {
  projectId: string;
  taskId: string;
}

export default function ClientPortalComments({ projectId, taskId }: ClientPortalCommentsProps) {
  const [comment, setComment] = useState('');
  const { socket } = useSocket();
  const { data, isLoading, error, refetch } = useGetClientPortalTaskCommentsQuery(
    { projectId, taskId },
    { skip: !projectId || !taskId }
  );
  const [addComment, { isLoading: isSending }] = useAddClientPortalTaskCommentMutation();

  useEffect(() => {
    const onPortalComment = (event: { projectId: string; taskId: string }) => {
      if (event.projectId === projectId && event.taskId === taskId) void refetch();
    };
    socket?.on('portal:task-comment', onPortalComment);
    return () => {
      socket?.off('portal:task-comment', onPortalComment);
    };
  }, [projectId, refetch, socket, taskId]);

  if ((error as any)?.status === 404) return null;

  const comments = data?.body?.comments || [];
  const submit = async () => {
    const value = comment.trim();
    if (!value) return;
    try {
      await addComment({ projectId, taskId, comment: value }).unwrap();
      setComment('');
    } catch (requestError: any) {
      message.error(requestError?.data?.message || 'Client portal comment could not be sent');
    }
  };

  return (
    <Flex vertical gap={12}>
      <Alert
        type="info"
        showIcon
        message="Client-visible conversation"
        description="Messages here are visible in the assigned client's portal. Internal task comments stay private."
      />
      <List
        loading={isLoading}
        dataSource={comments}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No client portal messages" /> }}
        renderItem={item => (
          <List.Item>
            <List.Item.Meta
              avatar={
                <Avatar
                  icon={item.sender_type === 'client' ? <CustomerServiceOutlined /> : <TeamOutlined />}
                />
              }
              title={
                <Flex gap={8} align="center">
                  <Typography.Text strong>{item.sender_name}</Typography.Text>
                  <Tag color={item.sender_type === 'client' ? 'gold' : 'blue'}>
                    {item.sender_type === 'client' ? 'Client' : 'SDM team'}
                  </Tag>
                </Flex>
              }
              description={
                <Flex vertical gap={4}>
                  <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{item.comment}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(item.created_at).toLocaleString()}
                  </Typography.Text>
                </Flex>
              }
            />
          </List.Item>
        )}
      />
      <Input.TextArea
        value={comment}
        onChange={event => setComment(event.target.value)}
        maxLength={5000}
        autoSize={{ minRows: 2, maxRows: 6 }}
        placeholder="Write a client-visible update"
      />
      <Button
        type="primary"
        icon={<SendOutlined />}
        onClick={submit}
        loading={isSending}
        disabled={!comment.trim()}
        style={{ alignSelf: 'flex-end' }}
      >
        Send to client portal
      </Button>
    </Flex>
  );
}
