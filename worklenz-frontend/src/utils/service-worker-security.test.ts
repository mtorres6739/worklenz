import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const serviceWorker = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

describe('protected deployment browser caching', () => {
  it('loads the web manifest with Cloudflare Access credentials', () => {
    expect(indexHtml).toContain(
      '<link rel="manifest" href="/manifest.json" crossorigin="use-credentials" />'
    );
  });

  it.each([
    '/^\\/api\\//',
    '/^\\/secure\\//',
    '/^\\/csrf-token$/',
    '/^\\/public\\//',
    '/^\\/webhook\\//',
    '/^\\/socket(?:\\.io)?\\//',
  ])('excludes protected responses matching %s from service-worker caching', pattern => {
    expect(serviceWorker).toContain(pattern);
  });

  it('includes credentials for protected same-origin static requests', () => {
    expect(serviceWorker).toContain("credentials: 'include'");
  });
});
