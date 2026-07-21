export type NavRoutesType = {
  name: string;
  path: string;
  adminOnly: boolean;
  freePlanFeature?: boolean;
  teamLeadOnly?: boolean;
  capability?: 'schedule' | 'reporting' | 'teamReports' | 'clientPortal';
};

export const navRoutes: NavRoutesType[] = [
  {
    name: 'home',
    path: '/worklenz/home',
    adminOnly: false,
    freePlanFeature: true,
  },
  {
    name: 'projects',
    path: '/worklenz/projects',
    adminOnly: false,
    freePlanFeature: true,
  },
  {
    name: 'schedule',
    path: '/worklenz/schedule',
    adminOnly: true,
    freePlanFeature: false,
    capability: 'schedule',
  },
  {
    name: 'reporting',
    path: '/worklenz/reporting/overview',
    adminOnly: true,
    freePlanFeature: false,
    capability: 'reporting',
  },
  {
    name: 'Team Reports',
    path: '/worklenz/team-lead-reports',
    adminOnly: false,
    freePlanFeature: true,
    teamLeadOnly: true,
    capability: 'teamReports',
  },
  {
    name: 'client-portal',
    path: '/worklenz/client-portal/clients',
    adminOnly: true,
    freePlanFeature: false,
    capability: 'clientPortal',
  },
];
