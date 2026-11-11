import {
  type CatalogAuthorityGrant,
  createManagementCatalogAuthority,
  createSsoManagementCatalogAuthority,
} from './catalog-authority.ts';
import { type CatalogElement, renderCatalogView } from './catalog-view.ts';

/** DOM coordinator only. The trusted caller owns grants and session teardown. */
export function mountManagementCatalog(root: CatalogElement) {
  return mountCatalog(root, createManagementCatalogAuthority);
}

/** Explicit SSO DOM adapter. Does not authenticate, supply grants or activate the public entry. */
export function mountSsoManagementCatalog(root: CatalogElement) {
  return mountCatalog(root, createSsoManagementCatalogAuthority);
}

function mountCatalog(
  root: CatalogElement,
  createAuthority: typeof createManagementCatalogAuthority,
) {
  let navigate = false;
  const authority = createAuthority({
    onChange(snapshot) {
      renderCatalogView(root, snapshot, actions, navigate);
      if (snapshot.state !== 'loading' && snapshot.state !== 'idle') navigate = false;
    },
  });
  const actions = {
    list() {
      navigate = true;
      void authority.list();
    },
    detail(id: string) {
      navigate = true;
      void authority.detail(id);
    },
  };
  renderCatalogView(root, authority.snapshot(), actions);
  return {
    /** No UI input may be promoted to a grant. */
    async authorize(grant: CatalogAuthorityGrant) {
      authority.authorize(grant);
      await authority.list();
    },
    clear: authority.clear,
    dispose: authority.dispose,
  };
}
