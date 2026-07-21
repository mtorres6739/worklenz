import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthService } from '@/hooks/useAuth';

export const useAuthStatus = () => {
  const authService = useAuthService();
  const location = useLocation();

  const status = useMemo(() => {
    try {
      if (!authService || typeof authService.isAuthenticated !== 'function') {
        return {
          isAuthenticated: false,
          isLicenseExpired: false,
          isAdmin: false,
          isSetupComplete: false,
        };
      }

      const isAuthenticated = authService.isAuthenticated();
      if (!isAuthenticated) {
        return {
          isAuthenticated: false,
          isLicenseExpired: false,
          isAdmin: false,
          isSetupComplete: false,
        };
      }

      const currentSession = authService.getCurrentSession();
      const isAdmin = authService.isOwnerOrAdmin();
      const isSetupComplete = currentSession?.setup_completed ?? false;
      return { isAuthenticated, isLicenseExpired: false, isAdmin, isSetupComplete };
    } catch (error) {
      console.error('Error in useAuthStatus:', error);
      return {
        isAuthenticated: false,
        isLicenseExpired: false,
        isAdmin: false,
        isSetupComplete: false,
      };
    }
  }, [authService]);

  return { ...status, location };
};
