import {
  Flex,
  Typography,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Switch,
  message,
} from '@/shared/antd-imports';
import Button from 'antd/lib/button';
import { useTranslation } from 'react-i18next';
import { PlusOutlined, FileTextOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { InvoicesTable } from './Invoices-table/invoices-table';
import { useResponsive } from '../../../hooks/useResponsive';
import {
  useGetPortalPaymentSettingsAdminQuery,
  useUpdatePortalPaymentSettingsAdminMutation,
} from '@/api/client-portal/client-portal-api';
import { useBusinessFeatures } from '@/worklenz-ee/hooks/use-business-features';
import { useEffect, useState } from 'react';

const ClientPortalInvoices = () => {
  // localization
  const { t } = useTranslation('client-portal-invoices');
  const { isDesktop } = useResponsive();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm] = Form.useForm();
  const { hasCapability } = useBusinessFeatures();
  const hasPayments = hasCapability('clientPortalPayments');
  const hasStripeCheckout = hasCapability('stripeCheckout');
  const { data: settings } = useGetPortalPaymentSettingsAdminQuery(undefined, {
    skip: !hasPayments,
  });
  const [updateSettings, updateSettingsState] = useUpdatePortalPaymentSettingsAdminMutation();

  useEffect(() => {
    if (settings?.body) {
      settingsForm.setFieldsValue({
        ...settings.body,
        stripe_enabled: hasStripeCheckout ? settings.body.stripe_enabled : false,
      });
    }
  }, [hasStripeCheckout, settings?.body, settingsForm]);

  // function to handle add invoices - navigate to invoice builder
  const handleAddInvoice = () => {
    navigate('/worklenz/client-portal/invoices/create');
  };

  return (
    <div
      style={{
        maxWidth: '100%',
        minHeight: 'calc(100vh - 120px)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: isDesktop ? 32 : 24 }}>
        <Flex align="center" justify="space-between" style={{ width: '100%' }} wrap="wrap" gap={16}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Flex align="center" gap={12} style={{ marginBottom: 8 }}>
              <FileTextOutlined style={{ fontSize: 20 }} />
              <Typography.Title
                level={4}
                style={{
                  margin: 0,
                  fontSize: '20px',
                }}
              >
                {t('title') || 'Invoices'}
              </Typography.Title>
            </Flex>
            <Typography.Text
              type="secondary"
              style={{
                fontSize: isDesktop ? '16px' : '14px',
                lineHeight: 1.5,
              }}
            >
              {t('description') || 'Manage and track your invoices'}
            </Typography.Text>
          </div>

          <Flex gap={8}>
            {hasPayments && (
              <Button onClick={() => setSettingsOpen(true)}>Payment settings</Button>
            )}
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddInvoice}>
              {t('addInvoiceButton') || 'Add Invoice'}
            </Button>
          </Flex>
        </Flex>
      </div>

      {/* Invoices Table */}
      <Card
        style={{
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          borderRadius: 8,
        }}
      >
        <InvoicesTable />
      </Card>
      <Modal
        title="Client payment settings"
        open={settingsOpen}
        confirmLoading={updateSettingsState.isLoading}
        onCancel={() => setSettingsOpen(false)}
        onOk={() =>
          settingsForm
            .validateFields()
            .then(values => updateSettings(values).unwrap())
            .then(() => {
              message.success('Payment settings updated.');
              setSettingsOpen(false);
            })
            .catch(() => message.error('Unable to update payment settings.'))
        }
      >
        <Form
          form={settingsForm}
          layout="vertical"
          initialValues={{
            manual_enabled: false,
            stripe_enabled: false,
            default_payment_terms_days: 14,
          }}
        >
          <Form.Item
            name="default_payment_terms_days"
            label="Default payment terms (days)"
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={365} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="manual_enabled" label="Allow manual payments" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(previous, current) =>
              previous.manual_enabled !== current.manual_enabled
            }
          >
            {({ getFieldValue }) =>
              getFieldValue('manual_enabled') ? (
                <Form.Item
                  name="manual_instructions"
                  label="Manual payment instructions"
                  rules={[{ required: true }]}
                >
                  <Input.TextArea rows={5} maxLength={5000} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item
            name="stripe_enabled"
            label="Allow Stripe Checkout"
            valuePropName="checked"
            extra={
              hasStripeCheckout
                ? 'The server verifies the configured Stripe account before this can be enabled.'
                : 'Stripe Checkout is disabled at the deployment level.'
            }
          >
            <Switch disabled={!hasStripeCheckout} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ClientPortalInvoices;
