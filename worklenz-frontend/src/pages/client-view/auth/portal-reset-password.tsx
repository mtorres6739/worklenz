import { Alert, Button, Form, Input, Typography } from '@/shared/antd-imports';
import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useRequestPasswordResetMutation, useResetPasswordMutation } from '@/api/client-portal/portal-client.api';
import PortalAuthShell from './PortalAuthShell';

export default function PortalResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [requestReset, { isLoading: requesting }] = useRequestPasswordResetMutation();
  const [reset, { isLoading: resetting }] = useResetPasswordMutation();
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const request = async ({ email }: { email: string }) => {
    try {
      await requestReset({ email }).unwrap();
      setNotice({ type: 'success', message: 'If that account exists, a reset link has been sent.' });
    } catch (error: any) {
      setNotice({ type: 'error', message: error?.data?.message || 'Unable to request a reset link.' });
    }
  };

  const update = async ({ password }: { password: string }) => {
    try {
      await reset({ token, password }).unwrap();
      navigate('/portal/login', { replace: true, state: { passwordReset: true } });
    } catch (error: any) {
      setNotice({ type: 'error', message: error?.data?.message || 'Unable to update the password.' });
    }
  };

  return (
    <PortalAuthShell
      title={token ? 'Choose a new password' : 'Reset your password'}
      subtitle={token ? 'Your reset link can only be used once.' : 'We will send a private reset link if the account exists.'}
    >
      {notice && <Alert type={notice.type} showIcon message={notice.message} style={{ marginBottom: 18 }} />}
      {token ? (
        <Form layout="vertical" requiredMark={false} onFinish={update}>
          <Form.Item name="password" label="New password" extra="At least 12 characters with upper, lower, number, and symbol." rules={[{ required: true }, { min: 12 }]}>
            <Input.Password size="large" autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" size="large" htmlType="submit" block loading={resetting}>Update password</Button>
        </Form>
      ) : (
        <Form layout="vertical" requiredMark={false} onFinish={request}>
          <Form.Item name="email" label="Email" rules={[{ required: true }, { type: 'email' }]}>
            <Input size="large" autoComplete="email" />
          </Form.Item>
          <Button type="primary" size="large" htmlType="submit" block loading={requesting}>Send reset link</Button>
        </Form>
      )}
      <Typography.Paragraph style={{ margin: '18px 0 0', textAlign: 'center' }}>
        <Link to="/portal/login">Back to sign in</Link>
      </Typography.Paragraph>
    </PortalAuthShell>
  );
}
