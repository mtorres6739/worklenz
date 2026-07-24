import { Table, Tag, Typography } from '@/shared/antd-imports';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  PortalInvoice,
  useGetPortalInvoicesQuery,
} from '@/api/client-portal/portal-client.api';

const statusColor: Record<string, string> = {
  sent: 'processing',
  payment_pending: 'warning',
  paid: 'success',
  overdue: 'error',
  cancelled: 'default',
};

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

const InvoicesTable = () => {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const { data, isLoading } = useGetPortalInvoicesQuery({ page, limit });

  return (
    <Table<PortalInvoice>
      loading={isLoading}
      rowKey="id"
      dataSource={data?.invoices || []}
      columns={[
        {
          title: 'Invoice',
          dataIndex: 'invoiceNumber',
          render: value => <Typography.Text strong>{value}</Typography.Text>,
        },
        {
          title: 'Service',
          dataIndex: 'serviceName',
          render: value => value || 'Services',
        },
        {
          title: 'Total',
          render: (_, invoice) => money(invoice.amount, invoice.currency),
        },
        {
          title: 'Due',
          dataIndex: 'dueDate',
          render: value =>
            value
              ? new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
                  timeZone: 'UTC',
                })
              : 'Upon receipt',
        },
        {
          title: 'Status',
          dataIndex: 'status',
          render: value => (
            <Tag color={statusColor[value] || 'default'}>
              {String(value).replaceAll('_', ' ')}
            </Tag>
          ),
        },
      ]}
      pagination={{
        current: page,
        pageSize: limit,
        total: data?.total || 0,
        showSizeChanger: true,
        onChange: (nextPage, nextLimit) => {
          setPage(nextPage);
          setLimit(nextLimit);
        },
      }}
      onRow={invoice => ({
        onClick: () => navigate(`/client-portal/invoices/${invoice.id}`),
        style: { cursor: 'pointer' },
      })}
      scroll={{ x: 720 }}
      locale={{ emptyText: 'No invoices are available.' }}
    />
  );
};

export default InvoicesTable;
