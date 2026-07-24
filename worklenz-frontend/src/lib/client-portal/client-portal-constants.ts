import React, { ReactNode, lazy } from 'react';

const ClientPortalClients = lazy(
  () => import('../../pages/client-portal/clients/ClientPortalClients')
);
import { AppstoreOutlined, FileTextOutlined, GroupOutlined } from '@ant-design/icons';

export type ClientPortalMenuItems = {
  key: string;
  name: string;
  endpoint: string;
  icon?: ReactNode;
  element: ReactNode;
  children?: ClientPortalMenuItems[];
};

export const clientPortalItems: ClientPortalMenuItems[] = [
  {
    key: 'clients',
    name: 'clients',
    endpoint: 'clients',
    icon: React.createElement(GroupOutlined),
    element: React.createElement(ClientPortalClients),
  },
  {
    key: 'services',
    name: 'services',
    endpoint: 'services',
    icon: React.createElement(AppstoreOutlined),
    element: false,
  },
  {
    key: 'requests',
    name: 'requests',
    endpoint: 'requests',
    icon: React.createElement(FileTextOutlined),
    element: false,
  },
  {
    key: 'invoices',
    name: 'invoices',
    endpoint: 'invoices',
    icon: React.createElement(FileTextOutlined),
    element: false,
  },
];
