import { Alert, Button, Form, Input, Result, Skeleton, Typography } from '@/shared/antd-imports';
import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAcceptInvitationMutation, useGetInvitationQuery } from '@/api/client-portal/portal-client.api';
import PortalAuthShell from './PortalAuthShell';

export default function PortalInvite() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { data: invitation, isLoading, error: inviteError } = useGetInvitationQuery(token, { skip: !token });
  const [accept, { isLoading: accepting }] = useAcceptInvitationMutation();
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <PortalAuthShell title="Checking invitation" subtitle="One moment while we verify your private link."><Skeleton active /></PortalAuthShell>;
  if (inviteError || !invitation) {
    return (
      <PortalAuthShell title="Invitation unavailable" subtitle="This invitation is invalid, expired, or has already been used.">
        <Result status="warning" extra={<Link to="/portal/login">Go to portal sign in</Link>} />
      </PortalAuthShell>
    );
  }

  const submit = async (values: { name: string; password: string }) => {
    setError(null);
    try {
      await accept({ token, ...values }).unwrap();
      navigate('/client-portal/dashboard', { replace: true });
    } catch (requestError: any) {
      setError(requestError?.data?.message || 'The invitation could not be accepted.');
    }
  };

  return (
    <PortalAuthShell
      title={`Join ${invitation.client_name}`}
      subtitle={
        invitation.has_existing_account
          ? `Link your existing portal account to ${invitation.organization_name}.`
          : `Create your secure portal account for ${invitation.organization_name}.`
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 18 }} />}
      <Typography.Paragraph type="secondary">
        Invitation for <strong>{invitation.email}</strong>
      </Typography.Paragraph>
      <Form
        layout="vertical"
        requiredMark={false}
        initialValues={{ name: invitation.name }}
        onFinish={submit}
      >
        <Form.Item name="name" label="Your name" rules={[{ required: true }, { max: 120 }]}>
          <Input size="large" autoComplete="name" />
        </Form.Item>
        <Form.Item
          name="password"
          label={invitation.has_existing_account ? 'Existing portal password' : 'Create password'}
          extra={
            invitation.has_existing_account
              ? 'Use the password you already use for the client portal.'
              : 'At least 12 characters with upper, lower, number, and symbol.'
          }
          rules={[{ required: true }, { min: 12 }]}
        >
          <Input.Password
            size="large"
            autoComplete={invitation.has_existing_account ? 'current-password' : 'new-password'}
          />
        </Form.Item>
        {!invitation.has_existing_account && (
          <Form.Item
            name="confirm"
            label="Confirm password"
            dependencies={['password']}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return !value || getFieldValue('password') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password size="large" autoComplete="new-password" />
          </Form.Item>
        )}
        <Button type="primary" size="large" htmlType="submit" block loading={accepting}>
          Accept invitation
        </Button>
      </Form>
    </PortalAuthShell>
  );
}
