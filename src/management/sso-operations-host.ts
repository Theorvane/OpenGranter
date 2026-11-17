import type { ManagementBoundaryState } from './boundary-view.ts';
import type { CatalogAuthorityOptions } from './catalog-authority.ts';
import type { CatalogElement } from './catalog-view.ts';
import type { HistoryDownload } from './history-app.ts';
import { mountSessionManagementOperations } from './operations-session.ts';
import {
  createSsoManagementRequest,
  type SsoManagementRequestOptions,
} from './sso-bearer-request.ts';

type LockedState = Exclude<ManagementBoundaryState, 'loading'>;
type ApprovedSsoGrant = Omit<SsoManagementRequestOptions, 'now'>;

/** Explicit host composition, not authentication or automatic entry activation.
 * Only an existing trusted session supplies token/expiry/fetch. The host must
 * clear on logout/identity change. No storage, refresh or mutation rollback.
 */
export function mountSsoManagementOperations(
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
  const app = mountSessionManagementOperations(root, createDownload, {
    now,
    schedule: (delay, callback) => {
      try {
        return schedule(delay, callback);
      } catch {
        release();
        throw new Error('Management scheduler unavailable');
      }
    },
  });
  let generation = 0;
  let stopped = false;
  let transport: ReturnType<typeof createSsoManagementRequest> | undefined;
  let cancel: (() => void) | undefined;
  function release() {
    const current = ++generation;
    const previous = transport;
    const cleanup = cancel;
    transport = undefined;
    cancel = undefined;
    previous?.dispose();
    try {
      cleanup?.();
    } catch {
      /* Never preserve a bearer on cleanup failure. */
    }
    return current;
  }
  function clear(state: LockedState = 'unauthenticated') {
    if (stopped) return;
    const current = release();
    if (!stopped && current === generation) app.clear(state);
  }
  function arm(current: number, expiresAt: number) {
    if (stopped || current !== generation) return;
    try {
      const time = now();
      if (!Number.isFinite(time) || time < 0 || time >= expiresAt) {
        clear('expired');
        return;
      }
      cancel = schedule(Math.max(1, Math.min(2147483647, expiresAt - time)), () => {
        if (stopped || current !== generation) return;
        cancel = undefined;
        arm(current, expiresAt);
      });
    } catch {
      if (current === generation) clear('unavailable');
    }
  }
  return Object.freeze({
    authorize(grant: ApprovedSsoGrant) {
      if (stopped) return;
      const current = release();
      if (stopped || current !== generation) return;
      app.clear();
      if (stopped || current !== generation) return;
      let next: ReturnType<typeof createSsoManagementRequest>;
      try {
        next = createSsoManagementRequest({ ...grant, now });
      } catch {
        if (current === generation) app.clear('unavailable');
        return;
      }
      if (stopped || current !== generation) {
        next.dispose();
        return;
      }
      transport = next;
      arm(current, grant.expiresAt);
      if (current !== generation) return;
      app.authorize({
        expiresAt: grant.expiresAt,
        request: async (path, init) => {
          const response = await next.request(path, init);
          if (current === generation && (response.status === 401 || response.status === 403)) {
            // Preserve the server status; the session mount owns its boundary.
            release();
          }
          return response;
        },
      });
    },
    clear,
    dispose() {
      if (stopped) return;
      stopped = true;
      release();
      app.dispose();
    },
  });
}
