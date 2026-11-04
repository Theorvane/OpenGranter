import {
  type CatalogAuthorityGrant,
  createManagementCatalogAuthority,
} from './catalog-authority.ts';
import { type CatalogElement, renderCatalogView } from './catalog-view.ts';

/** DOM coordinator only. The trusted caller owns grants and session teardown. */
export function mountManagementCatalog(root: CatalogElement) {
  let navigate = false;
  const authority = createManagementCatalogAuthority({
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
