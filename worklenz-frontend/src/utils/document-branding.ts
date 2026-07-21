const TITLE_STORAGE_KEY = 'sdm_app_title';

export function setBrandedPageTitle(section: string) {
  const base = localStorage.getItem(TITLE_STORAGE_KEY) || 'Worklenz';
  document.title = section ? `${base} | ${section}` : base;
}

export function applyBrandingBaseTitle(baseTitle: string) {
  const base = baseTitle.trim() || 'SDM Projects';
  const separator = document.title.indexOf(' | ');
  const section = separator >= 0 ? document.title.slice(separator + 3) : '';
  localStorage.setItem(TITLE_STORAGE_KEY, base);
  document.title = section ? `${base} | ${section}` : base;
}
