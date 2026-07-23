import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ClientPortalLayout from './client-portal-layout';

const mocks = vi.hoisted(() => ({
  capabilitiesLoaded: false,
  hasClientPortalAccess: true,
  isAuthenticated: true,
  trackMixpanelEvent: vi.fn(),
}));

vi.mock('../hooks/useAppSelector', () => ({
  useAppSelector: () => 'light',
}));

vi.mock('../hooks/useResponsive', () => ({
  useResponsive: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuthService: () => ({
    isAuthenticated: () => mocks.isAuthenticated,
  }),
}));

vi.mock('@/worklenz-ee/hooks/use-business-features', () => ({
  useBusinessFeatures: () => ({
    capabilitiesLoaded: mocks.capabilitiesLoaded,
    hasCapability: () => mocks.hasClientPortalAccess,
  }),
}));

vi.mock('@/hooks/useMixpanelTracking', () => ({
  useMixpanelTracking: () => ({
    trackMixpanelEvent: mocks.trackMixpanelEvent,
  }),
}));

vi.mock('@/features/navbar/navbar', () => ({
  default: () => <div>Navbar</div>,
}));

vi.mock('../pages/client-portal/sidebar/client-portal-sidebar', () => ({
  default: () => <div>Client portal navigation</div>,
}));

vi.mock('../lib/client-portal/client-portal-constants', () => ({
  clientPortalItems: [],
}));

vi.mock('../utils/themeWiseColor', () => ({
  themeWiseColor: (light: string) => light,
}));

vi.mock('@/shared/worklenz-analytics-events', () => ({
  evt_client_portal_viewed: 'client-portal-viewed',
}));

const renderLayout = () =>
  render(
    <MemoryRouter initialEntries={['/worklenz/client-portal/clients']}>
      <Routes>
        <Route path="/worklenz/client-portal" element={<ClientPortalLayout />}>
          <Route path="clients" element={<div>Clients loaded</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

describe('ClientPortalLayout', () => {
  beforeEach(() => {
    mocks.capabilitiesLoaded = false;
    mocks.hasClientPortalAccess = true;
    mocks.isAuthenticated = true;
    mocks.trackMixpanelEvent.mockClear();
  });

  it('keeps hook order stable when capabilities finish loading', () => {
    const view = renderLayout();

    mocks.capabilitiesLoaded = true;
    view.rerender(
      <MemoryRouter initialEntries={['/worklenz/client-portal/clients']}>
        <Routes>
          <Route path="/worklenz/client-portal" element={<ClientPortalLayout />}>
            <Route path="clients" element={<div>Clients loaded</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Clients loaded')).toBeInTheDocument();
    expect(mocks.trackMixpanelEvent).toHaveBeenCalledWith('client-portal-viewed');
  });
});
