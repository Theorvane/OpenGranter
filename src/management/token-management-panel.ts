import { mountManagementBoundaryView } from './boundary-view.ts';
import type { CatalogRequest } from './catalog-client.ts';
import type { CatalogElement } from './catalog-view.ts';
import { mountTokenIssuancePanel } from './token-issue-panel.ts';
import { mountTokenRevocationPanel } from './token-revoke-panel.ts';

/** Caller owns approved authority and MUST dispose on logout, expiry or identity change.
 * Cleanup/abort is not revocation and does not establish a mutation's outcome.
 */
export function mountTokenManagementPanel(root: CatalogElement, request: CatalogRequest) {
  let stopped = false;
  const children: { dispose(): void }[] = [];
  const clear = () => {
    for (const child of children) child.dispose();
    children.length = 0;
    root.replaceChildren();
  };
  const guardedRequest: CatalogRequest = async (path, init) => {
    if (stopped || init.signal?.aborted) throw new Error('Token management stopped');
    const response = await request(path, init);
    if (!stopped && !init.signal?.aborted && (response.status === 401 || response.status === 403)) {
      stopped = true;
      clear();
      mountManagementBoundaryView(root, response.status === 401 ? 'unauthenticated' : 'denied');
    }
    return response;
  };
  const section = root.ownerDocument.createElement('section');
  section.setAttribute('aria-label', 'Proxy-token management');
  const issuanceRoot = root.ownerDocument.createElement('div');
  const revocationRoot = root.ownerDocument.createElement('div');
  section.append(issuanceRoot, revocationRoot);
  root.replaceChildren(section);
  children.push(
    mountTokenIssuancePanel(issuanceRoot, guardedRequest),
    mountTokenRevocationPanel(revocationRoot, guardedRequest),
  );
  return {
    dispose() {
      stopped = true;
      clear();
    },
  };
}
