import ClientViewLayout from '@/layouts/client-view-layout';
import ClientViewDashboard from '@/pages/client-view/dashboard/client-view-dashboard';
import ClientViewProjects from '@/pages/client-view/projects/client-view-projects';
import ClientViewProjectDetails from '@/pages/client-view/projects/project-details/client-view-project-details';
import { RouteObject } from 'react-router-dom';

const clientViewRoutes: RouteObject[] = [
  {
    path: 'client-portal',
    element: <ClientViewLayout />,
    children: [
      {
        index: true,
        element: <ClientViewDashboard />,
      },
      {
        path: 'dashboard',
        element: <ClientViewDashboard />,
      },
      {
        path: 'projects',
        element: <ClientViewProjects />,
      },
      {
        path: 'projects/:id',
        element: <ClientViewProjectDetails />,
      },
    ],
  },
];

export default clientViewRoutes;
