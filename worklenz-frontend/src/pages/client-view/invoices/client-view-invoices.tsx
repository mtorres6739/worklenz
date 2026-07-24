import { Flex, Typography } from '@/shared/antd-imports';
import InvoicesTable from './Invoices-table/invoices-table';
// Removed AddInvoiceDrawer import
// import AddInvoiceDrawer from '../../../features/client-view/invoices/add-invoice-drawer';
// import { useAppDispatch } from '../../../hooks/useAppDispatch';
// import { toggleAddInvoiceDrawer } from '../../../features/client-view/invoices/invoices-slice';

const ClientViewInvoices = () => {
  return (
    <Flex vertical gap={24} style={{ width: '100%' }}>
      <Flex align="center" justify="space-between" style={{ width: '100%' }}>
        <div>
          <Typography.Title level={4} style={{ marginBottom: 4 }}>
            Invoices
          </Typography.Title>
          <Typography.Text type="secondary">
            View invoices, download PDFs, and submit payment securely.
          </Typography.Text>
        </div>
      </Flex>

      <InvoicesTable />
    </Flex>
  );
};

export default ClientViewInvoices;
