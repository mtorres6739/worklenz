import { Alert, Card, Col, Flex, Row, Spin, Statistic, Typography } from '@/shared/antd-imports';
import React from 'react';
import { CheckCircleOutlined, CommentOutlined, ProjectOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { useGetDashboardQuery, useGetSessionQuery } from '@/api/client-portal/portal-client.api';

const ClientViewDashboard = () => {
  const { data: session } = useGetSessionQuery();
  const { data, isLoading, error } = useGetDashboardQuery();
  const stats = data?.stats || {};

  return (
    <Flex vertical gap={24} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Welcome, {session?.user.name || 'Client'}
        </Typography.Title>
        <Typography.Text type="secondary">
          Only projects explicitly shared with your company appear here.
        </Typography.Text>
      </div>

      {error && <Alert type="error" showIcon message="The portal dashboard could not be loaded." />}
      <Spin spinning={isLoading}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card><Statistic title="Shared projects" value={stats.totalProjects || 0} prefix={<ProjectOutlined />} /></Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card><Statistic title="Active projects" value={stats.activeProjects || 0} prefix={<ProjectOutlined />} valueStyle={{ color: '#1677ff' }} /></Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card><Statistic title="Completed tasks" value={stats.completedTasks || 0} suffix={`/ ${stats.totalTasks || 0}`} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#389e0d' }} /></Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card><Statistic title="Unread comments" value={stats.unreadComments || 0} prefix={<CommentOutlined />} valueStyle={{ color: '#d46b08' }} /></Card>
          </Col>
        </Row>
      </Spin>

      <Card>
        <Flex align="flex-start" gap={12}>
          <UnorderedListOutlined style={{ marginTop: 4, color: '#1677ff' }} />
          <div>
            <Typography.Text strong>Collaboration access</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
              Project visibility, comments, and files are controlled separately by SDM. Contact your project manager if something expected is missing.
            </Typography.Paragraph>
          </div>
        </Flex>
      </Card>
    </Flex>
  );
};

export default ClientViewDashboard;
