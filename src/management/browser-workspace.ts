import type { CatalogAuthorityGrant, CatalogAuthorityOptions } from './catalog-authority.ts';
import type { CatalogElement } from './catalog-view.ts';
import {
  type CsvDownloadAnchor,
  type CsvDownloadPorts,
  createCsvDownload,
} from './csv-download.ts';
import { mountSessionManagementWorkspace } from './workspace-session.ts';

type PageEvent = 'pagehide' | 'pageshow';
export interface BrowserWorkspacePorts<Anchor extends CsvDownloadAnchor> {
  readonly downloads: CsvDownloadPorts<Anchor>;
  readonly lifecycle: {
    addEventListener(type: PageEvent, listener: () => void): void;
    removeEventListener(type: PageEvent, listener: () => void): void;
  };
}

/** Explicit browser integration, not a grant source or public entry.
 * BFCache restoration always needs a fresh trusted authorization. Local cleanup
 * cannot recall downloaded files, revoke tokens or roll back server mutations.
 */
export function mountBrowserManagementWorkspace<Anchor extends CsvDownloadAnchor>(
  root: CatalogElement,
  ports: BrowserWorkspacePorts<Anchor>,
  options: Pick<CatalogAuthorityOptions, 'now' | 'schedule'> = {},
) {
  let disposed = false;
  let hidden = false;
  const workspace = mountSessionManagementWorkspace(
    root,
    () => createCsvDownload(ports.downloads),
    options,
  );
  const hide = () => {
    if (disposed) return;
    hidden = true;
    workspace.clear();
  };
  const show = () => {
    if (!disposed) hidden = false;
  };
  try {
    ports.lifecycle.addEventListener('pagehide', hide);
    ports.lifecycle.addEventListener('pageshow', show);
  } catch {
    // A partially registered adapter must not leave a live private workspace.
    dispose();
    throw new Error('Management browser lifecycle unavailable');
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const [type, listener] of [
      ['pagehide', hide],
      ['pageshow', show],
    ] as const) {
      try {
        ports.lifecycle.removeEventListener(type, listener);
      } catch {
        // Private browser-port diagnostics must not escape teardown.
      }
    }
    try {
      workspace.dispose();
    } finally {
      root.replaceChildren();
    }
  }
  return Object.freeze({
    authorize(grant: CatalogAuthorityGrant) {
      if (!disposed && !hidden) workspace.authorize(grant);
    },
    clear() {
      if (!disposed) workspace.clear();
    },
    dispose,
  });
}
