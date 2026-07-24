import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Flex,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from '@/shared/antd-imports';
import {
  ArrowLeftOutlined,
  CreditCardOutlined,
  DownloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { ChangeEvent, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  useCreatePortalInvoiceCheckoutMutation,
  useDownloadPortalInvoiceMutation,
  useGetPortalInvoiceQuery,
  useGetPortalPaymentSettingsQuery,
  useGetSessionQuery,
  useSubmitPortalPaymentEvidenceMutation,
} from '@/api/client-portal/portal-client.api';

const statusColor: Record<string, string> = {
  sent: 'processing',
  payment_pending: 'warning',
  paid: 'success',
  overdue: 'error',
  cancelled: 'default',
};

const ClientViewInvoiceDetails = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: session } = useGetSessionQuery();
  const paymentReturn = searchParams.get('payment') === 'success';
  const { data: invoice, isLoading, isError } = useGetPortalInvoiceQuery(id, {
    pollingInterval: paymentReturn ? 2500 : 0,
  });
  const { data: settings } = useGetPortalPaymentSettingsQuery(undefined, {
    skip: !session?.capabilities.payments,
  });
  const [createCheckout, checkoutState] = useCreatePortalInvoiceCheckoutMutation();
  const [downloadInvoice, downloadState] = useDownloadPortalInvoiceMutation();
  const [submitEvidence, evidenceState] = useSubmitPortalPaymentEvidenceMutation();

  const formatMoney = useMemo(
    () => (amount: number) =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: invoice?.currency || 'USD',
      }).format(amount),
    [invoice?.currency]
  );

  if (isLoading) return <Spin size="large" />;
  if (isError || !invoice) {
    return (
      <Alert
        type="error"
        showIcon
        message="Invoice unavailable"
        description="This invoice was not found or is not assigned to your client account."
      />
    );
  }

  const canPay = !['paid', 'cancelled'].includes(invoice.status);

  const onDownload = async () => {
    try {
      const blob = await downloadInvoice(invoice.id).unwrap();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('Unable to download this invoice.');
    }
  };

  const onCheckout = async () => {
    try {
      const result = await createCheckout(invoice.id).unwrap();
      window.location.assign(result.checkoutUrl);
    } catch {
      message.error('Unable to start secure card checkout.');
    }
  };

  const onEvidence = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await submitEvidence({ id: invoice.id, file }).unwrap();
      message.success('Payment evidence submitted for review.');
    } catch {
      message.error('Unable to submit payment evidence.');
    }
  };

  return (
    <Flex vertical gap={20} style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
        <Flex align="center" gap={12}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/client-portal/invoices')}
          />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {invoice.invoiceNumber}
            </Typography.Title>
            <Tag color={statusColor[invoice.status] || 'default'}>
              {invoice.status.replaceAll('_', ' ')}
            </Tag>
          </div>
        </Flex>
        <Button
          icon={<DownloadOutlined />}
          loading={downloadState.isLoading}
          onClick={onDownload}
        >
          Download PDF
        </Button>
      </Flex>

      {paymentReturn && invoice.status !== 'paid' && (
        <Alert
          type="info"
          showIcon
          message="Payment confirmation is processing"
          description="This page will update when Stripe confirms the signed webhook. A browser redirect alone never marks an invoice paid."
        />
      )}

      <Card>
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }}>
          <Descriptions.Item label="Total">
            <Typography.Text strong>{formatMoney(invoice.amount)}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="Due date">
            {invoice.dueDate
              ? new Date(`${invoice.dueDate}T12:00:00Z`).toLocaleDateString('en-US', {
                  timeZone: 'UTC',
                })
              : 'Upon receipt'}
          </Descriptions.Item>
          <Descriptions.Item label="Service">
            {invoice.serviceName || 'Services'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Invoice items">
        <Table
          rowKey="id"
          pagination={false}
          dataSource={invoice.items}
          columns={[
            { title: 'Description', dataIndex: 'description' },
            { title: 'Quantity', dataIndex: 'quantity', align: 'right' },
            {
              title: 'Rate',
              dataIndex: 'unitAmount',
              align: 'right',
              render: value => formatMoney(Number(value)),
            },
            {
              title: 'Amount',
              dataIndex: 'lineAmount',
              align: 'right',
              render: value => formatMoney(Number(value)),
            },
          ]}
          scroll={{ x: 600 }}
        />
        <Flex vertical gap={8} style={{ maxWidth: 360, marginLeft: 'auto', marginTop: 20 }}>
          <Flex justify="space-between">
            <span>Subtotal</span>
            <span>{formatMoney(invoice.subtotal)}</span>
          </Flex>
          {invoice.discountAmount > 0 && (
            <Flex justify="space-between">
              <span>Discount</span>
              <span>-{formatMoney(invoice.discountAmount)}</span>
            </Flex>
          )}
          <Flex justify="space-between">
            <span>Tax ({invoice.taxRate}%)</span>
            <span>{formatMoney(invoice.taxAmount)}</span>
          </Flex>
          <Divider style={{ margin: '4px 0' }} />
          <Flex justify="space-between">
            <Typography.Text strong>Total</Typography.Text>
            <Typography.Text strong>{formatMoney(invoice.amount)}</Typography.Text>
          </Flex>
        </Flex>
      </Card>

      {invoice.notes && (
        <Card title="Notes">
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {invoice.notes}
          </Typography.Paragraph>
        </Card>
      )}

      {canPay && session?.capabilities.payments && (
        <Card title="Payment options">
          <Flex vertical gap={14}>
            {session.capabilities.stripeCheckout && settings?.stripeEnabled && (
              <Button
                type="primary"
                size="large"
                icon={<CreditCardOutlined />}
                loading={checkoutState.isLoading}
                onClick={onCheckout}
              >
                Pay securely with Stripe
              </Button>
            )}
            {settings?.manualEnabled && (
              <>
                {settings.manualInstructions && (
                  <Alert
                    type="info"
                    showIcon
                    message="Manual payment instructions"
                    description={
                      <span style={{ whiteSpace: 'pre-wrap' }}>
                        {settings.manualInstructions}
                      </span>
                    }
                  />
                )}
                <label>
                  <input
                    type="file"
                    hidden
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={onEvidence}
                  />
                  <Button
                    icon={<UploadOutlined />}
                    loading={evidenceState.isLoading}
                    onClick={event => {
                      const input = event.currentTarget
                        .closest('label')
                        ?.querySelector('input[type="file"]') as HTMLInputElement | null;
                      input?.click();
                    }}
                  >
                    Upload payment evidence
                  </Button>
                </label>
              </>
            )}
            {!settings?.manualEnabled &&
              !(session.capabilities.stripeCheckout && settings?.stripeEnabled) && (
                <Typography.Text type="secondary">
                  Contact the SDM team for payment instructions.
                </Typography.Text>
              )}
          </Flex>
        </Card>
      )}
    </Flex>
  );
};

export default ClientViewInvoiceDetails;
