import {
  AppstoreOutlined,
  DashboardOutlined,
  FileTextOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import React, { ReactNode } from 'react';
import ClientViewProjects from '../../pages/client-view/projects/client-view-projects';

// type of a menu item in client view sidebar
type clientViewMenuItems = {
  key: string;
  name: string;
  endpoint: string;
  icon: ReactNode;
  element: ReactNode;
  disabled?: boolean;
};
// clientView all element items use for sidebar and routes
export const clientViewItems: clientViewMenuItems[] = [
  {
    key: 'dashboard',
    name: 'Dashboard',
    endpoint: 'dashboard',
    icon: React.createElement(DashboardOutlined),
    element: false,
    disabled: false,
  },
  {
    key: 'projects',
    name: 'projects',
    endpoint: 'projects',
    icon: React.createElement(AppstoreOutlined),
    element: React.createElement(ClientViewProjects),
  },
  {
    key: 'services',
    name: 'services',
    endpoint: 'services',
    icon: React.createElement(ShopOutlined),
    element: false,
  },
  {
    key: 'requests',
    name: 'requests',
    endpoint: 'requests',
    icon: React.createElement(FileTextOutlined),
    element: false,
  },
];
