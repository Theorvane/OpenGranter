import type { CatalogAuthorityGrant, CatalogAuthorityOptions } from './catalog-authority.ts';
import type { CatalogElement } from './catalog-view.ts';
import { mountSsoManagementCatalog } from './sso-catalog-app.ts';

/** Explicit page composition, not session acquisition or server logout.
 * Pass the actual Window as lifecycle. Clear before bfcache capture and require
 * fresh trusted authority after restoration; never persist or replay a grant.
 */
export function mountSsoManagementCatalogPage(
  root: CatalogElement,
  lifecycle: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  options: Omit<CatalogAuthorityOptions, 'onChange'> = {},
) {
  const app = mountSsoManagementCatalog(root, options);
  let active = true;
  let disposed = false;
  const hide = () => {
    if (disposed) return;
    active = false;
    app.clear('unauthenticated');
  };
  const show = () => {
    if (!disposed) active = true;
  };
  lifecycle.addEventListener('pagehide', hide);
  lifecycle.addEventListener('pageshow', show);
  return {
    async authorize(grant: CatalogAuthorityGrant) {
      if (!active || disposed) return;
      await app.authorize(grant);
    },
    clear: app.clear,
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      lifecycle.removeEventListener('pagehide', hide);
      lifecycle.removeEventListener('pageshow', show);
      app.dispose();
    },
  };
}
