import type { CatalogRequest } from './catalog-client.ts';
import { createSsoManagementCatalogSession } from './catalog-session.ts';
import { type CatalogElement, renderCatalogView } from './catalog-view.ts';

/** One trusted caller-owned identity epoch, not an authenticator. The caller
 * must dispose on logout, expiry or identity change. Never synthesizes a grant.
 */
export function mountCatalogWorkspace(root: CatalogElement, request: CatalogRequest) {
  const session = createSsoManagementCatalogSession();
  let disposed = false;
  let revision = 0;
  async function read(operation: () => Promise<void>) {
    if (disposed) return;
    const current = ++revision;
    const pending = operation();
    // The guarded request may synchronously trigger caller-owned teardown.
    if (disposed || current !== revision) return;
    renderCatalogView(root, session.snapshot(), actions);
    await pending;
    if (!disposed && current === revision) {
      renderCatalogView(root, session.snapshot(), actions, true);
    }
  }
  const actions = {
    list() {
      void read(() => session.list());
    },
    detail(id: string) {
      void read(() => session.detail(id));
    },
  };
  session.authorize(request);
  actions.list();
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
