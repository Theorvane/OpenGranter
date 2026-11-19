import { type ManagementBoundaryState, mountManagementBoundaryView } from './boundary-view.ts';
import {
  type CatalogAuthorityGrant,
  type CatalogAuthorityOptions,
  createSsoManagementCatalogAuthority,
} from './catalog-authority.ts';
import type { CatalogRequest } from './catalog-client.ts';
import { type CatalogElement, renderCatalogView } from './catalog-view.ts';
import type { HistoryDownload } from './history-app.ts';
import { mountSessionManagementOperations } from './operations-session.ts';

type LockedState = Exclude<ManagementBoundaryState, 'loading'>;
type View = 'models' | 'operations';

/** Opt-in composition of existing signed-SSO screens, not a session issuer.
 * The trusted caller supplies authority and clears on logout/identity change.
 * Disposing local UI never revokes a token or rolls back a pending mutation.
 */
export function mountSessionManagementWorkspace(
  root: CatalogElement,
  createDownload: () => HistoryDownload,
  options: Pick<CatalogAuthorityOptions, 'now' | 'schedule'> = {},
) {
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((delay, callback) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    });
  let disposed = false;
  let revision = 0;
  let screen = 0;
  let grant: CatalogAuthorityGrant | undefined;
  let child: { dispose(): void } | undefined;
  let cancel: (() => void) | undefined;

  function releaseScreen() {
    const currentScreen = ++screen;
    const current = revision;
    const previous = child;
    child = undefined;
    try {
      previous?.dispose();
    } catch {
      /* Clear DOM despite private cleanup failures. */
    }
    if (current === revision && currentScreen === screen) root.replaceChildren();
  }
  function invalidate() {
    const current = ++revision;
    grant = undefined;
    const cleanup = cancel;
    cancel = undefined;
    try {
      cleanup?.();
    } catch {
      /* No private diagnostics. */
    }
    if (current === revision) releaseScreen();
    return current;
  }
  function clear(state: LockedState = 'unauthenticated') {
    if (disposed) return;
    const current = invalidate();
    if (current === revision) mountManagementBoundaryView(root, state);
  }
  function time() {
    try {
      const value = now();
      return Number.isFinite(value) && value >= 0 ? value : NaN;
    } catch {
      return NaN;
    }
  }
  function valid(current: number, currentScreen?: number): boolean {
    if (
      disposed ||
      revision !== current ||
      !grant ||
      (currentScreen !== undefined && screen !== currentScreen)
    )
      return false;
    const value = time();
    if (!Number.isFinite(value) || value >= grant.expiresAt) {
      clear('expired');
      return false;
    }
    return true;
  }
  function arm(current: number) {
    if (!valid(current) || !grant) return;
    try {
      cancel = schedule(Math.max(1, Math.min(2147483647, grant.expiresAt - time())), () => {
        if (!valid(current)) return;
        cancel = undefined;
        arm(current);
      });
    } catch {
      clear('unavailable');
    }
  }
  function navigate(view: View) {
    const current = revision;
    if (!valid(current) || !grant) return;
    releaseScreen();
    if (!valid(current) || !grant) return;
    const currentScreen = screen;
    const active = () => valid(current, currentScreen);
    const trusted = grant;
    const request: CatalogRequest = async (path, init) => {
      if (!active() || init.signal?.aborted) throw new Error('Management workspace stopped');
      const response = await trusted.request(path, init);
      if (!active() || init.signal?.aborted) {
        try {
          void response.body?.cancel().catch(() => undefined);
        } catch {
          /* Private cleanup. */
        }
        throw new Error('Management workspace stopped');
      }
      if (response.status === 401 || response.status === 403) {
        clear(response.status === 401 ? 'unauthenticated' : 'denied');
      }
      return response;
    };
    const element = (tag: string, label?: string) => {
      const node = root.ownerDocument.createElement(tag);
      if (label !== undefined) node.textContent = label;
      return node;
    };
    const navigation = element('nav');
    navigation.setAttribute('aria-label', 'Management workspace');
    for (const [target, label] of [
      ['models', 'Models'],
      ['operations', 'Operations'],
    ] as const) {
      const button = element('button', label);
      button.setAttribute('type', 'button');
      button.setAttribute('aria-pressed', String(view === target));
      button.addEventListener('click', () => {
        if (active()) navigate(target);
      });
      navigation.append(button);
    }
    const content = element('div');
    root.replaceChildren(navigation, content);
    let mounted: { dispose(): void };
    try {
      if (view === 'operations') {
        const operations = mountSessionManagementOperations(content, createDownload, options);
        mounted = operations;
        child = operations;
        operations.authorize({ request, expiresAt: trusted.expiresAt });
      } else {
        const authority = createSsoManagementCatalogAuthority({
          ...options,
          onChange(snapshot) {
            if (active())
              renderCatalogView(content, snapshot, {
                list() {
                  if (active()) void authority.list();
                },
                detail(id) {
                  if (active()) void authority.detail(id);
                },
              });
          },
        });
        mounted = authority;
        child = authority;
        authority.authorize({ request, expiresAt: trusted.expiresAt });
        void authority.list();
      }
    } catch {
      if (active()) clear('unavailable');
      return;
    }
    if (!active()) {
      try {
        mounted.dispose();
      } catch {
        /* Already cleared. */
      }
    }
  }
  mountManagementBoundaryView(root, 'unauthenticated');
  return Object.freeze({
    authorize(value: CatalogAuthorityGrant) {
      if (disposed) return;
      const current = invalidate();
      if (current !== revision || disposed) return;
      try {
        if (
          !value ||
          typeof value.request !== 'function' ||
          !Number.isSafeInteger(value.expiresAt) ||
          value.expiresAt < 0
        ) {
          clear('unavailable');
          return;
        }
        grant = { request: value.request, expiresAt: value.expiresAt };
      } catch {
        clear('unavailable');
        return;
      }
      arm(current);
      if (valid(current)) navigate('models');
    },
    clear,
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
    },
  });
}
