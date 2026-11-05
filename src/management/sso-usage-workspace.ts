import type { CatalogAuthorityGrant } from './catalog-authority.ts';
import type { CatalogRequest } from './catalog-client.ts';
import { mountSsoManagementCatalog } from './sso-catalog-app.ts';
import {
  mountManagementUsage,
  type UsageAuthorityOptions,
  type UsageElement,
} from './usage-app.ts';

type View = 'models' | 'usage';
type Cleared = 'unauthenticated' | 'expired' | 'denied';

/** Explicit trusted composition, not a session or public authority API.
 * One active app, no cross-view cache. The caller still owns server logout,
 * permission-change clearing and obtaining fresh grants from its approved adapter.
 * This module neither mounts a listener nor activates an installed usage schema.
 */
export function mountSsoUsageWorkspace(
  root: UsageElement,
  lifecycle: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  options: Omit<UsageAuthorityOptions, 'onInspectModel'> = {},
) {
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((delay: number, callback: () => void) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    });
  let grant: CatalogAuthorityGrant | undefined;
  let cancelTimer: (() => void) | undefined;
  let generation = 0;
  let renderRevision = 0;
  let view: View = 'models';
  let modelId: string | undefined;
  let reason: Cleared = 'unauthenticated';
  let active = true;
  let disposed = false;
  let app:
    | ReturnType<typeof mountSsoManagementCatalog>
    | ReturnType<typeof mountManagementUsage>
    | undefined;

  function removeAuthority() {
    generation++;
    grant = undefined;
    modelId = undefined;
    cancelTimer?.();
    cancelTimer = undefined;
  }
  function valid() {
    if (!grant) return false;
    const time = now();
    if (!Number.isFinite(time) || time >= grant.expiresAt) {
      clear('expired');
      return false;
    }
    return true;
  }
  function arm(current: number) {
    if (current !== generation || !valid() || !grant) return;
    cancelTimer = schedule(Math.max(1, Math.min(2147483647, grant.expiresAt - now())), () => {
      if (disposed || current !== generation) return;
      cancelTimer = undefined;
      arm(current);
    });
  }
  function clear(next: Cleared = 'unauthenticated') {
    if (disposed) return;
    removeAuthority();
    reason = next;
    void render();
  }
  async function render() {
    if (disposed) return;
    const rendered = ++renderRevision;
    app?.dispose();
    const element = (tag: string, text?: string) => {
      const node = root.ownerDocument.createElement(tag);
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const navigation = element('nav');
    navigation.setAttribute('aria-label', 'Management views');
    for (const [target, label] of [
      ['models', 'Models'],
      ['usage', 'Usage history'],
    ] as const) {
      const button = element('button', label);
      button.setAttribute('type', 'button');
      if (view === target) button.setAttribute('aria-current', 'page');
      button.addEventListener('click', () => {
        // A detached navigation control must not consume a renewed grant or
        // interrupt the current view after a rerender or page restoration.
        if (!active || disposed || rendered !== renderRevision) return;
        view = target;
        modelId = undefined;
        // A suspended timer must not let navigation dispatch with an old grant.
        if (grant && !valid()) return;
        void render();
      });
      navigation.append(button);
    }
    const content = element('div');
    root.replaceChildren(navigation, content);
    const mounted =
      view === 'models'
        ? mountSsoManagementCatalog(content, {
            ...options,
            onInspectUsage(id) {
              if (disposed || !active || app !== mounted || !valid()) return;
              view = 'usage';
              modelId = id;
              void render();
            },
          })
        : mountManagementUsage(content, {
            ...options,
            onInspectModel(id) {
              if (disposed || !active || app !== mounted || !valid()) return;
              view = 'models';
              modelId = id;
              void render();
            },
          });
    app = mounted;
    if (!grant) {
      mounted.clear(reason);
      return;
    }
    // The transport checks server authority freshly. No identity or bearer is
    // obtained here. Capture the generation so old 401/403 cannot clear renewal.
    const current = generation;
    const supplied = grant;
    const request: CatalogRequest = async (path, init) => {
      if (disposed || current !== generation || !active || !valid())
        throw Error('Management authority unavailable');
      const response = await supplied.request(path, init);
      if (
        current === generation &&
        !init.signal?.aborted &&
        (response.status === 401 || response.status === 403)
      ) {
        clear(response.status === 401 ? 'unauthenticated' : 'denied');
      }
      return response;
    };
    await mounted.authorize({ request, expiresAt: supplied.expiresAt }, modelId);
  }
  const hide = () => {
    if (disposed) return;
    active = false;
    clear();
  };
  const show = () => {
    if (!disposed) active = true;
  };
  lifecycle.addEventListener('pagehide', hide);
  lifecycle.addEventListener('pageshow', show);
  void render();
  return {
    async authorize(supplied: CatalogAuthorityGrant) {
      if (disposed || !active) return;
      removeAuthority();
      app?.dispose();
      const { request, expiresAt } = supplied;
      const time = now();
      if (
        typeof request !== 'function' ||
        !Number.isSafeInteger(expiresAt) ||
        !Number.isFinite(time) ||
        expiresAt <= time
      ) {
        clear('expired');
        return;
      }
      grant = { request, expiresAt };
      reason = 'unauthenticated';
      view = 'models';
      modelId = undefined;
      const current = generation;
      arm(current);
      if (current === generation) await render();
    },
    clear,
    dispose() {
      if (disposed) return;
      removeAuthority();
      disposed = true;
      active = false;
      lifecycle.removeEventListener('pagehide', hide);
      lifecycle.removeEventListener('pageshow', show);
      app?.dispose();
      app = undefined;
      root.replaceChildren();
    },
  };
}
