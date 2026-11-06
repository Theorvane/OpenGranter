import type { CatalogAuthorityGrant } from './catalog-authority.ts';
import {
  createManagementTokenAuthority,
  type TokenAuthorityOptions,
} from './token-management-authority.ts';

export interface TokenWorkspaceOptions extends Omit<TokenAuthorityOptions, 'onInvalidate'> {
  /** Read snapshot to render. No credential is passed to notifications. */
  readonly onChange?: () => void;
  /** Definite authentication denial, after single-flight completion; no secret. */
  readonly onAuthorityFailure?: (state: 'unauthenticated' | 'denied') => void;
}
export interface TokenWorkspaceSnapshot {
  /** Monotonic host-lifetime authority generation, not a credential. */
  readonly authorityRevision: number;
  readonly state: 'ready' | 'expired' | 'disposed';
  readonly busy: boolean;
  readonly reconciliationRequired: boolean;
  readonly secret?: { readonly credentialId: string; readonly token: string };
}

/** One owning host lifetime, not a session or reconciliation service.
 * Keep this instance above credential-screen navigation and grant replacement.
 * Do not reconstruct it to bypass an unknown outcome. Nothing is persisted;
 * cross-tab/reload reconciliation needs a separate approved server contract.
 */
export function createManagementTokenWorkspace(options: TokenWorkspaceOptions = {}) {
  let authority: ReturnType<typeof createManagementTokenAuthority> | undefined;
  let generation = 0;
  let state: TokenWorkspaceSnapshot['state'] = 'disposed';
  let busy = false;
  let uncertain = false;
  let secret: TokenWorkspaceSnapshot['secret'];
  const listeners = new Set<() => void>();
  function notify() {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* Observers cannot interrupt teardown. */
      }
    }
    try {
      options.onChange?.();
    } catch {
      // An observer cannot interrupt teardown or expose private errors.
    }
  }
  function detach() {
    const epoch = ++generation;
    if (busy) uncertain = true;
    secret = undefined;
    const old = authority;
    authority = undefined;
    old?.dispose();
    return epoch;
  }
  async function run(
    operation: (
      current: NonNullable<typeof authority>,
    ) =>
      | ReturnType<NonNullable<typeof authority>['issue']>
      | ReturnType<NonNullable<typeof authority>['revoke']>,
  ) {
    if (uncertain) return { state: 'reconciliation_required' } as const;
    if (busy) return { state: 'busy' } as const;
    const current = authority;
    const epoch = generation;
    const active = current?.isActive();
    // Validation may synchronously renew/logout via the host clock or expiry observer.
    // An action from the old view must not silently use replacement authority.
    if (epoch !== generation || current !== authority) return { state: 'disposed' } as const;
    if (!current || !active)
      return { state: state === 'expired' ? 'expired' : 'disposed' } as const;
    busy = true;
    secret = undefined;
    // Start before notifying: reentrant logout must abort this operation too.
    const pending = operation(current);
    notify();
    const result = await pending;
    busy = false;
    if (result.state === 'outcome_unknown' || epoch !== generation) {
      uncertain = true;
      secret = undefined;
      notify();
      return { state: 'outcome_unknown' } as const;
    }
    if (result.state === 'issued') {
      secret = Object.freeze({ credentialId: result.credentialId, token: result.token });
      notify();
      // Secrets have one owning display location, not a second result payload.
      return { state: 'issued' } as const;
    }
    notify();
    if (epoch === generation && (result.state === 'unauthenticated' || result.state === 'denied')) {
      try {
        options.onAuthorityFailure?.(result.state);
      } catch {
        // A host observer cannot change a definite response into an unknown write.
      }
    }
    return result;
  }
  return {
    /** Secret-free notifications. Host/screen must unsubscribe on unmount. */
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    authorize(grant: CatalogAuthorityGrant) {
      const epoch = detach();
      if (generation !== epoch) return;
      state = 'ready';
      const next = createManagementTokenAuthority(grant, {
        ...(options.now ? { now: options.now } : {}),
        ...(options.schedule ? { schedule: options.schedule } : {}),
        onInvalidate: (reason) => {
          if (generation !== epoch) return;
          state = reason;
          secret = undefined;
          if (busy && reason === 'expired') uncertain = true;
          notify();
        },
      });
      // Construction can synchronously notify expiry; a host may renew or logout.
      // Never publish an authority after a newer lifecycle action took ownership.
      if (generation !== epoch) {
        next.dispose();
        return;
      }
      authority = next;
      notify();
    },
    logout() {
      const epoch = detach();
      if (generation !== epoch) return;
      state = 'disposed';
      notify();
    },
    hideSecret() {
      if (busy) {
        const epoch = detach();
        if (generation !== epoch) return;
        state = 'disposed';
      }
      secret = undefined;
      notify();
    },
    snapshot(): TokenWorkspaceSnapshot {
      // Recheck even when an expiry timer was suspended by the browser.
      authority?.isActive();
      return Object.freeze({
        authorityRevision: generation,
        state,
        busy,
        reconciliationRequired: uncertain,
        ...(secret ? { secret } : {}),
      });
    },
    issue: (input: Parameters<NonNullable<typeof authority>['issue']>[0]) =>
      run((current) => current.issue(input)),
    revoke: (input: Parameters<NonNullable<typeof authority>['revoke']>[0]) =>
      run((current) => current.revoke(input)),
  };
}
