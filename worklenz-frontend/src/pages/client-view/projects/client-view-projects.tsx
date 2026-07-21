import { Alert, Empty, Flex, Spin, Typography } from '@/shared/antd-imports';
import React from 'react';
import ProjectsTable from './projects-table';
import { useGetProjectsQuery } from '@/api/client-portal/portal-client.api';

const ClientViewProjects = () => {
  const { data, isLoading, error } = useGetProjectsQuery();
  const projects = data?.projects || [];

  return (
    <Flex vertical gap={24} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>Projects</Typography.Title>
        <Typography.Text type="secondary">{projects.length} project{projects.length === 1 ? '' : 's'} shared with your company</Typography.Text>
      </div>
      {error && <Alert type="error" showIcon message="Projects could not be loaded." />}
      <Spin spinning={isLoading}>
        {projects.length ? <ProjectsTable projects={projects} /> : <Empty description="No projects have been shared yet." />}
      </Spin>
    </Flex>
  );
};

export default ClientViewProjects;
