import type { CatalogRequest } from './catalog-client.ts';
import { createSsoManagementCatalogSession } from './catalog-session.ts';
import { type CatalogElement, renderCatalogView } from './catalog-view.ts';
import { appendOperationsModelDetails } from './operations-model-details.ts';

/** Request-only child of trusted operations, not an authentication source.
 * Parent owns authority, denial handling and logout/expiry teardown.
 */
export function mountOperationsCatalog(root: CatalogElement, request: CatalogRequest) {
  const session = createSsoManagementCatalogSession();
  let disposed = false;
  let revision = 0;
  async function read(id?: string) {
    if (disposed) return;
    const current = ++revision;
    const pending = id === undefined ? session.list() : session.detail(id);
    renderCatalogView(root, session.snapshot(), actions);
    await pending;
    if (!disposed && current === revision) {
      const snapshot = session.snapshot();
      renderCatalogView(root, snapshot, actions, true);
      if (snapshot.state === 'detail') appendOperationsModelDetails(root, snapshot.model);
    }
  }
  const actions = {
    list: () => {
      void read();
    },
    detail: (id: string) => {
      void read(id);
    },
  };
  session.authorize(request);
  void read();
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      ++revision;
      session.dispose();
      root.replaceChildren();
    },
  });
}
