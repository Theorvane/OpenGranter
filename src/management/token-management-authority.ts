import type { CatalogAuthorityGrant } from './catalog-authority.ts';
import {
  createManagementTokenClient,
  type TokenIssueResult,
  type TokenRevokeResult,
} from './token-management-client.ts';

export interface TokenAuthorityOptions {
  readonly now?: () => number;
  /** Clear host-held private UI state. Called once, with no credential payload. */
  readonly onInvalidate?: (reason: 'expired' | 'disposed') => void;
  /** Callback must be asynchronous. Returns a cancellation function. */
  readonly schedule?: (delay: number, callback: () => void) => () => void;
}
type Expired = { readonly state: 'expired' };

/** Single trusted grant lifetime, not authentication, renewal or IAM.
 * No stored secrets, UI activation or reconciliation/reset facility. The host
 * must dispose on logout, principal/permission change and unmount. A new grant
 * must never be used to bypass an unresolved mutation outcome.
 */
export function createManagementTokenAuthority(
  grant: CatalogAuthorityGrant,
  options: TokenAuthorityOptions = {},
) {
  const request = grant.request;
  const expiresAt = grant.expiresAt;
  const now = options.now ?? Date.now;
  const onInvalidate = options.onInvalidate;
  const schedule =
    options.schedule ??
    ((delay, callback) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    });
  let terminal: 'expired' | 'disposed' | undefined;
  let cancel: (() => void) | undefined;
  let timerRevision = 0;
  const client = createManagementTokenClient((path, init) => {
    // Recheck immediately at the trusted transport boundary, not only at render.
    if (!live()) throw Error('Authority unavailable');
    return request(path, init);
  });
  function close(state: 'expired' | 'disposed') {
    if (terminal) return;
    terminal = state;
    timerRevision++;
    const cleanup = cancel;
    cancel = undefined;
    client.dispose();
    try {
      cleanup?.();
    } catch {
      // A host cleanup failure cannot reopen authority or suppress notification.
    }
    try {
      onInvalidate?.(state);
    } catch {
      // UI observer failures cannot prevent terminal abort or expose private errors.
    }
  }
  function clock() {
    try {
      return now();
    } catch {
      return NaN;
    }
  }
  function live() {
    if (terminal) return false;
    const time = clock();
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt < 0 ||
      !Number.isFinite(time) ||
      time < 0 ||
      expiresAt <= time
    ) {
      close('expired');
      return false;
    }
    return true;
  }
  function arm() {
    if (!live()) return;
    const time = clock();
    if (!Number.isFinite(time) || time < 0 || time >= expiresAt) {
      close('expired');
      return;
    }
    const revision = ++timerRevision;
    let installing = true;
    try {
      const cleanup = schedule(Math.max(1, Math.min(2147483647, expiresAt - time)), () => {
        if (terminal || revision !== timerRevision) return;
        // A synchronous scheduler violates the host contract; do not recurse.
        if (installing) {
          close('expired');
          return;
        }
        timerRevision++;
        cancel = undefined;
        if (live()) arm();
      });
      installing = false;
      if (typeof cleanup !== 'function') {
        close('expired');
        return;
      }
      if (terminal || revision !== timerRevision) {
        try {
          cleanup();
        } catch {
          // Terminal authority must remain closed even if cleanup fails.
        }
        return;
      }
      cancel = cleanup;
    } catch {
      installing = false;
      // No reliable expiry cleanup means no usable mutation authority.
      close('expired');
    }
  }
  async function run<T extends TokenIssueResult | TokenRevokeResult>(
    operation: () => Promise<T>,
  ): Promise<T | Expired | { readonly state: 'disposed' | 'outcome_unknown' }> {
    if (!live()) return { state: terminal ?? 'expired' };
    const result = await operation();
    // A suspended timer cannot allow completion to deliver a late secret.
    const valid = live();
    if (!valid && (result.state === 'issued' || result.state === 'revoked')) {
      return { state: 'outcome_unknown' };
    }
    if (result.state === 'unauthenticated' || result.state === 'denied') close('disposed');
    return result;
  }
  arm();
  return {
    issue: (input: Parameters<typeof client.issue>[0]) => run(() => client.issue(input)),
    revoke: (input: Parameters<typeof client.revoke>[0]) => run(() => client.revoke(input)),
    // Host snapshots must also recheck suspended expiry before displaying secrets.
    isActive: () => live(),
    dispose: () => close('disposed'),
  };
}
