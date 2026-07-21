import { Card, Flex, Typography } from '@/shared/antd-imports';
import React from 'react';

export default function PortalAuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Flex
      align="center"
      justify="center"
      style={{ minHeight: '100vh', padding: 24, background: '#f5f7fb' }}
    >
      <Card style={{ width: '100%', maxWidth: 460, borderRadius: 16, boxShadow: '0 18px 50px rgba(15, 23, 42, 0.08)' }}>
        <Flex vertical gap={6} style={{ marginBottom: 26 }}>
          <Typography.Text strong style={{ color: '#1677ff', letterSpacing: 0.4 }}>
            SDM CLIENT PROJECTS
          </Typography.Text>
          <Typography.Title level={2} style={{ margin: 0, fontSize: 28 }}>
            {title}
          </Typography.Title>
          <Typography.Text type="secondary">{subtitle}</Typography.Text>
        </Flex>
        {children}
        <Typography.Paragraph type="secondary" style={{ margin: '24px 0 0', fontSize: 12 }}>
          Access is invitation-only and limited to projects explicitly shared with your company.
        </Typography.Paragraph>
      </Card>
    </Flex>
  );
}
