import type { CatalogElement } from './catalog-view.ts';
import { mountSsoManagementCatalogPage } from './sso-catalog-page.ts';

// Structural ports keep browser globals out of server-only TypeScript libraries.
declare const document: { getElementById(id: string): CatalogElement | null };
declare const window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

const root = document.getElementById('app');
if (root) {
  // Public sign-in shell only: no ambient grant source or exported authority API.
  // The page mount owns pagehide teardown; pageshow cannot replay prior grants.
  mountSsoManagementCatalogPage(root, window);
}
