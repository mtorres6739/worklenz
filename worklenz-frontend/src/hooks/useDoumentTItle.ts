import { useEffect } from 'react';
import { setBrandedPageTitle } from '@/utils/document-branding';

export const useDocumentTitle = (title: string) => {
  return useEffect(() => {
    setBrandedPageTitle(title);
  }, [title]);
};
