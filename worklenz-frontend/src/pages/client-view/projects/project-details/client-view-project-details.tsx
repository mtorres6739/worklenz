import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Input,
  List,
  Progress,
  Row,
  Space,
  Spin,
  Table,
  TableProps,
  Tag,
  Typography,
  message,
} from '@/shared/antd-imports';
import { ArrowLeftOutlined, CommentOutlined, DownloadOutlined, FileOutlined } from '@ant-design/icons';
import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PortalTask,
  useAddCommentMutation,
  useDownloadFileMutation,
  useGetCommentsQuery,
  useGetFilesQuery,
  useGetProjectQuery,
  useGetTasksQuery,
} from '@/api/client-portal/portal-client.api';

function dateLabel(value?: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : 'Not set';
}

const ClientViewProjectDetails = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: project, isLoading: projectLoading, error: projectError } = useGetProjectQuery(id, { skip: !id });
  const { data: taskData, isLoading: tasksLoading } = useGetTasksQuery(id, { skip: !id });
  const { data: fileData, isLoading: filesLoading } = useGetFilesQuery(id, { skip: !id || project?.can_view_files === false });
  const [selectedTask, setSelectedTask] = useState<PortalTask | null>(null);
  const [comment, setComment] = useState('');
  const { data: commentData, isLoading: commentsLoading } = useGetCommentsQuery(
    { projectId: id, taskId: selectedTask?.id || '' },
    { skip: !id || !selectedTask }
  );
  const [addComment, { isLoading: addingComment }] = useAddCommentMutation();
  const [downloadFile, { isLoading: downloading }] = useDownloadFileMutation();

  const tasks = taskData?.tasks || [];
  const progress = project?.total_tasks
    ? Math.round((project.completed_tasks / project.total_tasks) * 100)
    : 0;

  const columns = useMemo<TableProps<PortalTask>['columns']>(() => [
    {
      key: 'task', title: 'Task',
      render: (_, task) => (
        <div style={{ paddingInlineStart: task.parent_task_id ? 22 : 0 }}>
          <Typography.Text strong={!task.parent_task_id}>{task.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ marginInlineStart: 8 }}>#{task.task_no}</Typography.Text>
        </div>
      ),
    },
    { key: 'status', title: 'Status', render: (_, task) => <Tag color={task.status_color}>{task.status}</Tag> },
    { key: 'priority', title: 'Priority', render: (_, task) => task.priority ? <Tag color={task.priority_color || undefined}>{task.priority}</Tag> : '—' },
    { key: 'due', title: 'Due', dataIndex: 'end_date', render: dateLabel },
    {
      key: 'comments', title: 'Comments',
      render: (_, task) => <Button type="link" icon={<CommentOutlined />} onClick={event => { event.stopPropagation(); setSelectedTask(task); }}>{task.portal_comment_count || 0}</Button>,
    },
  ], []);

  if (projectError) {
    return <Alert type="error" showIcon message="This project is unavailable or has not been shared with your account." />;
  }

  const submitComment = async () => {
    const value = comment.trim();
    if (!selectedTask || !value) return;
    try {
      await addComment({ projectId: id, taskId: selectedTask.id, comment: value }).unwrap();
      setComment('');
    } catch (error: any) {
      message.error(error?.data?.message || 'Comment could not be added.');
    }
  };

  const openFile = async (fileId: string, source: 'project' | 'task') => {
    try {
      const result = await downloadFile({ projectId: id, fileId, source }).unwrap();
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (error: any) {
      message.error(error?.data?.message || 'File could not be opened.');
    }
  };

  return (
    <Spin spinning={projectLoading}>
      <Flex vertical gap={20} style={{ width: '100%' }}>
        <Flex align="center" justify="space-between" gap={12} wrap="wrap">
          <div>
            <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/client-portal/projects')} style={{ paddingInline: 0 }}>Projects</Button>
            <Typography.Title level={3} style={{ margin: 0 }}>{project?.name}</Typography.Title>
            <Space style={{ marginTop: 8 }}>
              <Tag color="blue">{project?.status}</Tag>
              <Tag>{project?.access_level === 'comment' ? 'Comment access' : 'Read only'}</Tag>
            </Space>
          </div>
          <div style={{ minWidth: 220 }}>
            <Typography.Text type="secondary">Overall task progress</Typography.Text>
            <Progress percent={progress} />
          </div>
        </Flex>

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={16}>
            <Card title="Project overview">
              <Descriptions column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label="Start">{dateLabel(project?.start_date)}</Descriptions.Item>
                <Descriptions.Item label="Target finish">{dateLabel(project?.end_date)}</Descriptions.Item>
                <Descriptions.Item label="Tasks">{project?.completed_tasks || 0} of {project?.total_tasks || 0} complete</Descriptions.Item>
                <Descriptions.Item label="Project key">{project?.key}</Descriptions.Item>
              </Descriptions>
              {project?.description && <Typography.Paragraph style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>{project.description}</Typography.Paragraph>}
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title="Project team">
              {project?.members?.length ? (
                <List dataSource={project.members} renderItem={member => <List.Item><Space><Avatar>{member.name.charAt(0)}</Avatar><Typography.Text>{member.name}</Typography.Text></Space></List.Item>} />
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No team members listed" />}
            </Card>
          </Col>
        </Row>

        <Card title="Tasks">
          <Table
            rowKey="id"
            loading={tasksLoading}
            columns={columns}
            dataSource={tasks}
            pagination={{ pageSize: 30, size: 'small' }}
            scroll={{ x: 'max-content' }}
            onRow={task => ({ onClick: () => setSelectedTask(task), style: { cursor: 'pointer' } })}
          />
        </Card>

        {project?.can_view_files && (
          <Card title="Files" loading={filesLoading}>
            {fileData?.files?.length ? (
              <List
                dataSource={fileData.files}
                renderItem={file => (
                  <List.Item actions={[<Button key="download" type="link" icon={<DownloadOutlined />} loading={downloading} onClick={() => openFile(file.id, file.source)}>Open</Button>]}>
                    <List.Item.Meta avatar={<FileOutlined style={{ fontSize: 20 }} />} title={file.name} description={`${Math.max(1, Math.round(Number(file.size) / 1024))} KB · ${file.source === 'task' ? 'Task attachment' : 'Project file'}`} />
                  </List.Item>
                )}
              />
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No shared files" />}
          </Card>
        )}
      </Flex>

      <Drawer
        title={selectedTask ? `Task #${selectedTask.task_no}` : 'Task'}
        open={Boolean(selectedTask)}
        width={560}
        onClose={() => { setSelectedTask(null); setComment(''); }}
      >
        {selectedTask && (
          <Flex vertical gap={18}>
            <div>
              <Typography.Title level={4}>{selectedTask.name}</Typography.Title>
              <Space><Tag color={selectedTask.status_color}>{selectedTask.status}</Tag>{selectedTask.priority && <Tag>{selectedTask.priority}</Tag>}</Space>
              {selectedTask.description && <Typography.Paragraph style={{ marginTop: 14, whiteSpace: 'pre-wrap' }}>{selectedTask.description}</Typography.Paragraph>}
            </div>
            <Typography.Title level={5}>Client conversation</Typography.Title>
            <Spin spinning={commentsLoading}>
              <List
                locale={{ emptyText: 'No portal comments yet.' }}
                dataSource={commentData?.comments || []}
                renderItem={item => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={<Avatar style={{ background: item.sender_type === 'staff' ? '#1677ff' : '#64748b' }}>{item.sender_name.charAt(0)}</Avatar>}
                      title={<Space><Typography.Text strong>{item.sender_name}</Typography.Text><Tag>{item.sender_type === 'staff' ? 'SDM' : 'Client'}</Tag></Space>}
                      description={<><Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 4 }}>{item.comment}</Typography.Paragraph><Typography.Text type="secondary" style={{ fontSize: 12 }}>{new Date(item.created_at).toLocaleString()}</Typography.Text></>}
                    />
                  </List.Item>
                )}
              />
            </Spin>
            {project?.access_level === 'comment' ? (
              <Flex vertical gap={8}>
                <Input.TextArea value={comment} onChange={event => setComment(event.target.value)} maxLength={5000} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="Add a project comment…" />
                <Button type="primary" onClick={submitComment} loading={addingComment} disabled={!comment.trim()} style={{ alignSelf: 'flex-end' }}>Post comment</Button>
              </Flex>
            ) : <Alert type="info" showIcon message="This project is read-only." />}
          </Flex>
        )}
      </Drawer>
    </Spin>
  );
};

export default ClientViewProjectDetails;
