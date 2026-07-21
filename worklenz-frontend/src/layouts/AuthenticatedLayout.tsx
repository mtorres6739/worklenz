import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { SocketProvider } from '@/socket/socketContext';
import { ConfigProvider } from '@/shared/antd-imports';
import { systemApiService } from '@/api/system/system.api.service';
import { applyBrandingBaseTitle } from '@/utils/document-branding';

export const AuthenticatedLayout = () => {
  const [accentColor, setAccentColor] = useState('#1677ff');

  useEffect(() => {
    void systemApiService.getBranding().then(response => {
      if (!response.done || !response.body) return;
      const branding = response.body;
      setAccentColor(branding.accent_color || '#1677ff');
      applyBrandingBaseTitle(branding.page_title || 'SDM Projects');
      document.documentElement.style.setProperty('--sdm-accent-color', branding.accent_color || '#1677ff');
      if (branding.favicon_url) {
        const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') || document.createElement('link');
        link.rel = 'icon';
        link.href = branding.favicon_url;
        document.head.appendChild(link);
      }
    }).catch(() => undefined);
  }, []);

  return (
    <ConfigProvider theme={{ token: { colorPrimary: accentColor } }}>
      <SocketProvider>
        <Outlet />
      </SocketProvider>
    </ConfigProvider>
  );
};
