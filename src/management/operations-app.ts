import { mountManagementBoundaryView } from './boundary-view.ts';
import type { CatalogRequest } from './catalog-client.ts';
import type { CatalogElement } from './catalog-view.ts';
import { type HistoryDownload, mountHistoryWorkspace } from './history-app.ts';
import { mountOperationsCatalog } from './operations-catalog.ts';
import { mountTokenManagementPanel } from './token-management-panel.ts';

/** Explicit approved-caller integration, not an authentication boundary.
 * Caller MUST dispose on logout, known expiry or identity change. Navigation
 * aborts pending work; it cannot establish mutation outcomes or revoke tokens.
 */
export function mountManagementOperations(
  root: CatalogElement,
  request: CatalogRequest,
  createDownload: () => HistoryDownload,
) {
  let stopped = false;
  let epoch = 0;
  let child: { dispose(): void } | undefined;
  const element = (tag: string, label?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (label !== undefined) node.textContent = label;
    return node;
  };
  function clear() {
    const previous = child;
    child = undefined;
    previous?.dispose();
    root.replaceChildren();
  }
  function navigate(kind: 'history' | 'tokens' | 'models') {
    if (stopped) return;
    const current = ++epoch;
    clear();
    if (stopped || epoch !== current) return;
    const active = () => !stopped && epoch === current;
    const guarded: CatalogRequest = async (path, init) => {
      if (!active() || init.signal?.aborted) throw new Error('Management operations stopped');
      const response = await request(path, init);
      if (
        active() &&
        !init.signal?.aborted &&
        (response.status === 401 || response.status === 403)
      ) {
        stopped = true;
        ++epoch;
        clear();
        mountManagementBoundaryView(root, response.status === 401 ? 'unauthenticated' : 'denied');
      }
      return response;
    };
    const main = element('section');
    main.append(element('h1', 'Management operations'));
    const navigation = element('nav');
    navigation.setAttribute('aria-label', 'Management operations');
    for (const [target, label] of [
      ['history', 'History'],
      ['models', 'Models'],
      ['tokens', 'Proxy tokens'],
    ] as const) {
      const button = element('button', label);
      button.setAttribute('type', 'button');
      button.setAttribute('aria-pressed', String(kind === target));
      button.addEventListener('click', () => {
        if (active()) navigate(target);
      });
      navigation.append(button);
    }
    const content = element('div');
    main.append(
      navigation,
      element(
        'p',
        'Switching screens clears displayed tokens and cancels local requests. A pending mutation may still complete; verify its outcome before resubmitting. Clearing does not revoke tokens.',
      ),
      content,
    );
    root.replaceChildren(main);
    let mounted: { dispose(): void };
    if (kind === 'history') {
      let download: HistoryDownload;
      try {
        download = createDownload();
      } catch {
        if (active()) {
          const status = element('p', 'History unavailable. Try again.');
          status.setAttribute('role', 'alert');
          content.replaceChildren(status);
        }
        return;
      }
      if (!active()) {
        try {
          download.dispose();
        } catch {
          /* Teardown must not expose adapter diagnostics. */
        }
        return;
      }
      mounted = mountHistoryWorkspace(content, guarded, download);
    } else if (kind === 'models') {
      mounted = mountOperationsCatalog(content, guarded);
    } else {
      mounted = mountTokenManagementPanel(content, guarded);
    }
    if (active()) child = mounted;
    else mounted.dispose();
  }
  navigate('history');
  return Object.freeze({
    dispose() {
      stopped = true;
      ++epoch;
      clear();
    },
  });
}
