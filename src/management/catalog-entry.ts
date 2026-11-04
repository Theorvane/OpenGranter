import { mountManagementCatalog } from './catalog-app.ts';
import type { CatalogElement } from './catalog-view.ts';

// Structural ports preserve the repository's server-only TypeScript lib.
declare const document: { getElementById(id: string): CatalogElement | null };
declare const window: {
  addEventListener(type: string, listener: () => void, options: { once: boolean }): void;
};

const root = document.getElementById('app');
if (root) {
  const app = mountManagementCatalog(root);
  // No grant source, fetch, storage, or global API in this public entry.
  window.addEventListener('pagehide', app.dispose, { once: true });
}
