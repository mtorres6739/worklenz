import { Alert, Button, Form, Input, Typography } from '@/shared/antd-imports';
import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useGetSessionQuery, useLoginMutation } from '@/api/client-portal/portal-client.api';
import PortalAuthShell from './PortalAuthShell';

function errorMessage(error: any): string {
  return error?.data?.message || error?.message || 'Sign in failed. Check your email and password.';
}

export default function PortalLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session, isLoading: checking } = useGetSessionQuery();
  const [login, { isLoading }] = useLoginMutation();
  const [error, setError] = useState<string | null>(null);

  if (!checking && session?.authenticated) return <Navigate to="/client-portal/dashboard" replace />;

  const submit = async (values: { email: string; password: string }) => {
    setError(null);
    try {
      await login(values).unwrap();
      const destination = (location.state as any)?.from?.pathname || '/client-portal/dashboard';
      navigate(destination, { replace: true });
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  };

  return (
    <PortalAuthShell title="Client portal" subtitle="Sign in with the account created from your invitation.">
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 18 }} />}
      <Form layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item name="email" label="Email" rules={[{ required: true }, { type: 'email' }]}>
          <Input size="large" autoComplete="email" />
        </Form.Item>
        <Form.Item name="password" label="Password" rules={[{ required: true }]}>
          <Input.Password size="large" autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" size="large" htmlType="submit" block loading={isLoading}>
          Sign in
        </Button>
      </Form>
      <Typography.Paragraph style={{ margin: '18px 0 0', textAlign: 'center' }}>
        <Link to="/portal/reset-password">Forgot your password?</Link>
      </Typography.Paragraph>
    </PortalAuthShell>
  );
}
