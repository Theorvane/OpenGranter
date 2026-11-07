import {
  type CatalogAuthorityGrant,
  type CatalogAuthorityOptions,
  createSsoManagementCatalogAuthority,
} from './catalog-authority.ts';
import { type CatalogElement, renderCatalogView } from './catalog-view.ts';

/** Explicit SSO DOM composition only. No fetch, credential acquisition, session
 * persistence, global grant API or runtime activation is installed by this mount.
 * The trusted caller must supply authority and clear it on session teardown.
 */
export function mountSsoManagementCatalog(
  root: CatalogElement,
  options: Omit<CatalogAuthorityOptions, 'onChange'> & {
    readonly onInspectUsage?: (id: string) => void;
  } = {},
) {
  let navigate = false;
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
  const authority = createSsoManagementCatalogAuthority({
    ...options,
    onChange(snapshot) {
      renderCatalogView(
        root,
        snapshot,
        {
          ...actions,
          ...(options.onInspectUsage && snapshot.state === 'detail'
            ? {
                inspectUsage(id: string) {
                  // snapshot() checks expiry even when timers were suspended. Detached
                  // detail controls cannot act after navigation, renewal or teardown.
                  if (authority.snapshot() !== snapshot) return;
                  options.onInspectUsage?.(id);
                },
              }
            : {}),
        },
        navigate,
      );
      if (snapshot.state !== 'loading' && snapshot.state !== 'idle') navigate = false;
    },
  });
  renderCatalogView(root, authority.snapshot(), actions);
  return {
    /** Never promote UI input to a trusted grant. */
    async authorize(grant: CatalogAuthorityGrant, modelId?: string) {
      authority.authorize(grant);
      navigate = modelId !== undefined;
      if (modelId !== undefined) await authority.detail(modelId);
      else await authority.list();
    },
    clear: authority.clear,
    dispose: authority.dispose,
  };
}
