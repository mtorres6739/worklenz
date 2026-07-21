import apiClient from '@/api/api-client';
import { API_BASE_URL } from '@/shared/constants';
import { IServerResponse } from '@/types/common.types';

export interface OidcConfiguration {
  display_name: string;
  issuer: string;
  client_id: string;
  scopes: string[];
  enabled: boolean;
  has_client_secret: boolean;
  claim_mapping: { email?: string; name?: string; subject?: string };
}

export const oidcApiService = {
  async getConfiguration(): Promise<IServerResponse<OidcConfiguration | null>> {
    const response = await apiClient.get(`${API_BASE_URL}/oidc/configuration`);
    return response.data;
  },
  async saveConfiguration(input: {
    displayName: string;
    issuer: string;
    clientId: string;
    clientSecret?: string;
    scopes: string[];
    enabled: boolean;
    claimMapping: { email: string; name: string; subject: string };
  }): Promise<IServerResponse<OidcConfiguration>> {
    const response = await apiClient.put(`${API_BASE_URL}/oidc/configuration`, input);
    return response.data;
  },
  async testConfiguration(): Promise<IServerResponse<{ issuer: string; callbackUrl: string }>> {
    const response = await apiClient.post(`${API_BASE_URL}/oidc/test`);
    return response.data;
  },
};
