import { useEffect, useState } from 'react';
import { Button, Card, Flex, Form, Input, Switch, Typography, message } from '@/shared/antd-imports';
import { oidcApiService } from '@/api/oidc/oidc.api.service';

interface OidcFormValues {
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes: string;
  enabled: boolean;
  emailClaim: string;
  nameClaim: string;
  subjectClaim: string;
}

export function OidcIntegration() {
  const [form] = Form.useForm<OidcFormValues>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasSecret, setHasSecret] = useState(false);

  useEffect(() => {
    void oidcApiService.getConfiguration().then(response => {
      if (response.done && response.body) {
        form.setFieldsValue({
          displayName: response.body.display_name,
          issuer: response.body.issuer,
          clientId: response.body.client_id,
          scopes: (response.body.scopes || ['openid', 'profile', 'email']).join(' '),
          enabled: response.body.enabled,
          emailClaim: response.body.claim_mapping?.email || 'email',
          nameClaim: response.body.claim_mapping?.name || 'name',
          subjectClaim: response.body.claim_mapping?.subject || 'sub',
        });
        setHasSecret(response.body.has_client_secret);
      } else {
        form.setFieldsValue({
          scopes: 'openid profile email',
          enabled: false,
          emailClaim: 'email',
          nameClaim: 'name',
          subjectClaim: 'sub',
        });
      }
    }).finally(() => setLoading(false));
  }, [form]);

  const save = async (values: OidcFormValues) => {
    setSaving(true);
    try {
      const response = await oidcApiService.saveConfiguration({
        displayName: values.displayName,
        issuer: values.issuer,
        clientId: values.clientId,
        clientSecret: values.clientSecret || undefined,
        scopes: values.scopes.split(/\s+/).filter(Boolean),
        enabled: values.enabled,
        claimMapping: {
          email: values.emailClaim,
          name: values.nameClaim,
          subject: values.subjectClaim,
        },
      });
      if (!response.done) throw new Error(response.message || 'Unable to save OIDC configuration');
      setHasSecret(true);
      form.setFieldValue('clientSecret', '');
      message.success('OIDC configuration saved');
    } catch (error: any) {
      message.error(error?.response?.data?.message || error?.message || 'Unable to save OIDC configuration');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    try {
      const response = await oidcApiService.testConfiguration();
      if (!response.done) throw new Error(response.message || 'Discovery failed');
      message.success(`OIDC discovery verified. Callback: ${response.body?.callbackUrl}`);
    } catch (error: any) {
      message.error(error?.response?.data?.message || error?.message || 'OIDC discovery failed');
    }
  };

  return (
    <Card title="Single sign-on (OIDC)" styles={{ body: { padding: 24 } }}>
      <Typography.Paragraph type="secondary">
        Works with Google Workspace, Microsoft Entra, Authentik, and Keycloak. Unknown emails are rejected; invited users are provisioned into their assigned team.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={save} disabled={loading}>
        <Form.Item name="displayName" label="Provider name" rules={[{ required: true }]}>
          <Input maxLength={80} placeholder="SDM Workspace SSO" />
        </Form.Item>
        <Form.Item name="issuer" label="Issuer URL" rules={[{ required: true, type: 'url' }]}>
          <Input placeholder="https://accounts.google.com" />
        </Form.Item>
        <Form.Item name="clientId" label="Client ID" rules={[{ required: true }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="clientSecret"
          label={hasSecret ? 'Replace client secret' : 'Client secret'}
          rules={hasSecret ? [] : [{ required: true }]}
        >
          <Input.Password autoComplete="new-password" placeholder={hasSecret ? 'Stored securely; leave blank to keep it' : ''} />
        </Form.Item>
        <Form.Item name="scopes" label="Scopes" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Flex gap={12} wrap="wrap">
          <Form.Item name="emailClaim" label="Email claim" rules={[{ required: true }]} style={{ flex: 1, minWidth: 160 }}>
            <Input />
          </Form.Item>
          <Form.Item name="nameClaim" label="Name claim" rules={[{ required: true }]} style={{ flex: 1, minWidth: 160 }}>
            <Input />
          </Form.Item>
          <Form.Item name="subjectClaim" label="Subject claim" rules={[{ required: true }]} style={{ flex: 1, minWidth: 160 }}>
            <Input />
          </Form.Item>
        </Flex>
        <Form.Item name="enabled" label="Allow OIDC login" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Flex gap={8}>
          <Button type="primary" htmlType="submit" loading={saving}>Save</Button>
          <Button onClick={() => void test()} disabled={!hasSecret}>Test discovery</Button>
        </Flex>
      </Form>
    </Card>
  );
}
