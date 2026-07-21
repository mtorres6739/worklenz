import React, { ReactNode, lazy } from 'react';

const ClientPortalClients = lazy(
  () => import('../../pages/client-portal/clients/ClientPortalClients')
);
import { GroupOutlined } from '@ant-design/icons';

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
];
