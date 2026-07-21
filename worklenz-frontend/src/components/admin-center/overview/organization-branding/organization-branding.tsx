import { useEffect, useState } from 'react';
import { Button, Flex, Form, Input, Typography, message } from '@/shared/antd-imports';
import { adminCenterApiService } from '@/api/admin-center/admin-center.api.service';
import { applyBrandingBaseTitle } from '@/utils/document-branding';

interface BrandingForm {
  displayName?: string;
  accentColor: string;
  pageTitle: string;
  emailFromName?: string;
  emailFromAddress?: string;
}

const OrganizationBranding = () => {
  const [form] = Form.useForm<BrandingForm>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);

  useEffect(() => {
    void adminCenterApiService.getOrganizationBranding().then(response => {
      if (response.done) {
        const data = response.body || {};
        form.setFieldsValue({
          displayName: data.display_name || '',
          accentColor: data.accent_color || '#1677ff',
          pageTitle: data.page_title || 'SDM Projects',
          emailFromName: data.email_from_name || '',
          emailFromAddress: data.email_from_address || '',
        });
        setFaviconUrl(data.favicon_url || null);
      }
    }).finally(() => setLoading(false));
  }, [form]);

  const save = async (values: BrandingForm) => {
    setSaving(true);
    try {
      const response = await adminCenterApiService.updateOrganizationBranding(values);
      if (!response.done) throw new Error(response.message || 'Unable to save branding');
      applyBrandingBaseTitle(values.pageTitle);
      document.documentElement.style.setProperty('--sdm-accent-color', values.accentColor);
      message.success('Branding saved');
    } catch (error: any) {
      message.error(error?.response?.data?.message || error?.message || 'Unable to save branding');
    } finally {
      setSaving(false);
    }
  };

  const uploadFavicon = async (file: File) => {
    if (!['image/png', 'image/x-icon'].includes(file.type) || file.size > 512 * 1024) {
      message.error('Use a PNG or ICO favicon no larger than 512 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const response = await adminCenterApiService.uploadOrganizationFavicon(String(reader.result));
        if (!response.done) throw new Error(response.message || 'Unable to upload favicon');
        setFaviconUrl(response.body?.favicon_url || null);
        const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') || document.createElement('link');
        link.rel = 'icon';
        link.href = response.body?.favicon_url || '';
        document.head.appendChild(link);
        message.success('Favicon updated');
      } catch (error: any) {
        message.error(error?.response?.data?.message || error?.message || 'Unable to upload favicon');
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <Flex vertical gap={16}>
      <div>
        <Typography.Title level={5} style={{ marginBottom: 4 }}>SDM white-label settings</Typography.Title>
        <Typography.Text type="secondary">Applied to the staff app, portal-ready surfaces, emails, and invoice metadata.</Typography.Text>
      </div>
      <Form form={form} layout="vertical" onFinish={save} disabled={loading}>
        <Flex gap={16} wrap="wrap">
          <Form.Item name="displayName" label="Application name" style={{ minWidth: 240, flex: 1 }}>
            <Input maxLength={80} placeholder="SDM Projects" />
          </Form.Item>
          <Form.Item name="pageTitle" label="Browser page title" rules={[{ required: true }]} style={{ minWidth: 240, flex: 1 }}>
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item name="accentColor" label="Accent color" rules={[{ required: true, pattern: /^#[0-9a-f]{6}$/i }]} style={{ minWidth: 180 }}>
            <Input type="color" style={{ width: 96 }} />
          </Form.Item>
        </Flex>
        <Flex gap={16} wrap="wrap">
          <Form.Item name="emailFromName" label="Email sender name" style={{ minWidth: 240, flex: 1 }}>
            <Input maxLength={80} placeholder="Strategic Digital Marketing" />
          </Form.Item>
          <Form.Item name="emailFromAddress" label="Email sender address" rules={[{ type: 'email' }]} style={{ minWidth: 280, flex: 1 }}>
            <Input maxLength={255} placeholder="noreply@myfusionadmin.com" />
          </Form.Item>
        </Flex>
        <Flex align="center" gap={12} style={{ marginBottom: 16 }}>
          {faviconUrl ? <img src={faviconUrl} alt="Current favicon" width={32} height={32} /> : null}
          <Button onClick={() => document.getElementById('sdm-favicon-input')?.click()}>Upload favicon</Button>
          <input
            id="sdm-favicon-input"
            type="file"
            accept="image/png,image/x-icon,.ico"
            hidden
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void uploadFavicon(file);
              event.target.value = '';
            }}
          />
        </Flex>
        <Button type="primary" htmlType="submit" loading={saving}>Save branding</Button>
      </Form>
    </Flex>
  );
};

export default OrganizationBranding;
