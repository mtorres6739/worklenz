import apiClient from '@api/api-client';
import { API_BASE_URL } from '@/shared/constants';
import type { IServerResponse } from '@/types/common.types';

export interface IOrganizationBranding {
  display_name: string;
  accent_color: string;
  page_title: string;
  logo_url: string | null;
  favicon_url: string | null;
}

export const systemApiService = {
  getBranding: async (): Promise<IServerResponse<IOrganizationBranding>> => {
    const response = await apiClient.get<IServerResponse<IOrganizationBranding>>(
      `${API_BASE_URL}/system/branding`
    );
    return response.data;
  },
};
