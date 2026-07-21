import { Avatar, Card, Progress, Table, TableProps, Tag, Tooltip, Typography } from '@/shared/antd-imports';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import CustomAvatar from '../../../components/CustomAvatar';
import { PortalProject } from '@/api/client-portal/portal-client.api';

const ProjectsTable = ({ projects }: { projects: PortalProject[] }) => {
  const navigate = useNavigate();
  const columns: TableProps<PortalProject>['columns'] = [
    {
      key: 'name', title: 'Project', dataIndex: 'name',
      render: (value, record) => <div><Typography.Text strong>{value}</Typography.Text><br /><Typography.Text type="secondary">{record.key}</Typography.Text></div>,
    },
    { key: 'status', title: 'Status', dataIndex: 'status', render: value => <Tag color="blue">{value}</Tag> },
    {
      key: 'progress', title: 'Progress',
      render: (_, record) => {
        const percent = record.total_tasks > 0 ? Math.round((record.completed_tasks / record.total_tasks) * 100) : 0;
        return <Tooltip title={`${record.completed_tasks} of ${record.total_tasks} tasks complete`}><Progress percent={percent} style={{ minWidth: 150 }} /></Tooltip>;
      },
    },
    {
      key: 'members', title: 'Team',
      render: (_, record) => <Avatar.Group>{record.members.map(member => <CustomAvatar key={member.id} avatarName={member.name} />)}</Avatar.Group>,
    },
    { key: 'access', title: 'Access', dataIndex: 'access_level', render: value => <Tag>{value === 'comment' ? 'Can comment' : 'Read only'}</Tag> },
  ];
  return (
    <Card>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={projects}
        pagination={{ pageSize: 20, size: 'small' }}
        scroll={{ x: 'max-content' }}
        onRow={record => ({ onClick: () => navigate(`/client-portal/projects/${record.id}`), style: { cursor: 'pointer' } })}
      />
    </Card>
  );
};

export default ProjectsTable;
