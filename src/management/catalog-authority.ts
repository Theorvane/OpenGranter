import type { CatalogRequest } from './catalog-client.ts';
import {
  createManagementCatalogSession,
  createSsoManagementCatalogSession,
  type ManagementCatalogSnapshot,
} from './catalog-session.ts';

export interface CatalogAuthorityGrant {
  /** Supplied by a trusted session adapter, never constructed from UI input. */
  readonly request: CatalogRequest;
  /** Absolute epoch milliseconds from that same trusted session. */
  readonly expiresAt: number;
}
export interface CatalogAuthorityOptions {
  readonly onChange: (snapshot: ManagementCatalogSnapshot) => void;
  readonly now?: () => number;
  /** Returns a cancellation function; callback must be asynchronous. */
  readonly schedule?: (delay: number, callback: () => void) => () => void;
}

/** Expiry and rendering adapter only, not authentication or an IAM capability.
 * The request port must still enforce fresh server-side authentication and IAM.
 * Nothing here persists an identity, a token, or catalog data across sessions.
 */
export function createManagementCatalogAuthority(options: CatalogAuthorityOptions) {
  return createCatalogAuthority(options, createManagementCatalogSession);
}

/** Explicit SSO observer/expiry adapter, not a session authenticator.
 * No proxy fallback, credential bridge or automatic browser activation.
 */
export function createSsoManagementCatalogAuthority(options: CatalogAuthorityOptions) {
  return createCatalogAuthority(options, createSsoManagementCatalogSession);
}

function createCatalogAuthority(
  options: CatalogAuthorityOptions,
  createSession: typeof createManagementCatalogSession,
) {
  const session = createSession();
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((delay, callback) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    });
  let expiresAt: number | undefined;
  let cancel: (() => void) | undefined;
  let revision = 0;
  let disposed = false;

  function notify() {
    try {
      options.onChange(session.snapshot());
    } catch {
      // Observer errors must not interfere with authority teardown or leak text.
    }
  }
  function invalidate() {
    revision++;
    const cleanup = cancel;
    cancel = undefined;
    expiresAt = undefined;
    try {
      cleanup?.();
    } catch {
      // Host timer cleanup must never prevent abort or protected-state clearing.
    }
  }
  function clear(state: 'unauthenticated' | 'expired' | 'denied' | 'unavailable') {
    if (disposed) return;
    invalidate();
    session.clear(state);
    notify();
  }
  function clock() {
    try {
      return now();
    } catch {
      return NaN;
    }
  }
  function expired() {
    if (expiresAt === undefined) return false;
    const time = clock();
    if (!Number.isFinite(time) || time < 0 || time >= expiresAt) {
      clear('expired');
      return true;
    }
    return false;
  }
  function arm(current: number) {
    if (current !== revision || expiresAt === undefined || expired()) return;
    const time = clock();
    if (!Number.isFinite(time) || time < 0 || time >= expiresAt) {
      clear('expired');
      return;
    }
    const delay = Math.max(1, Math.min(2147483647, expiresAt - time));
    cancel = schedule(delay, () => {
      if (current !== revision || disposed) return;
      cancel = undefined;
      if (!expired()) arm(current);
    });
  }
  async function read(operation: () => Promise<void>) {
    if (disposed || expired() || expiresAt === undefined) return;
    const current = revision;
    const pending = operation();
    notify(); // Loading is synchronous; completion is published separately.
    await pending;
    if (current !== revision || disposed || expired()) return;
    const state = session.snapshot().state;
    if (state === 'unauthenticated' || state === 'denied') invalidate();
    notify();
  }
  return {
    authorize(grant: CatalogAuthorityGrant) {
      if (disposed) return;
      invalidate();
      const time = clock();
      if (
        !Number.isSafeInteger(grant.expiresAt) ||
        grant.expiresAt < 0 ||
        !Number.isFinite(time) ||
        time < 0 ||
        grant.expiresAt <= time
      ) {
        session.clear('expired');
        notify();
        return;
      }
      expiresAt = grant.expiresAt;
      session.authorize(grant.request);
      arm(revision);
      notify();
    },
    clear,
    cancel() {
      if (disposed || expired() || expiresAt === undefined) return;
      if (session.snapshot().state !== 'loading') return;
      session.cancel();
      notify();
    },
    snapshot(): ManagementCatalogSnapshot {
      expired();
      return session.snapshot();
    },
    list: () => read(() => session.list()),
    detail: (id: string) => read(() => session.detail(id)),
    dispose() {
      if (disposed) return;
      invalidate();
      disposed = true;
      session.dispose();
      notify();
    },
  };
}
