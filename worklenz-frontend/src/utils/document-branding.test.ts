import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyBrandingBaseTitle, setBrandedPageTitle } from './document-branding';

describe('document branding', () => {
  beforeEach(() => {
    vi.mocked(localStorage.getItem).mockReset();
    vi.mocked(localStorage.setItem).mockReset();
    document.title = '';
  });

  it('preserves the current page section when branding loads', () => {
    document.title = 'Worklenz | Projects';
    applyBrandingBaseTitle('SDM Client Projects');
    expect(document.title).toBe('SDM Client Projects | Projects');
  });

  it('uses the stored application name on later navigation', () => {
    applyBrandingBaseTitle('SDM Client Projects');
    expect(localStorage.setItem).toHaveBeenCalledWith('sdm_app_title', 'SDM Client Projects');
    vi.mocked(localStorage.getItem).mockReturnValue('SDM Client Projects');
    setBrandedPageTitle('Reporting');
    expect(document.title).toBe('SDM Client Projects | Reporting');
  });
});
