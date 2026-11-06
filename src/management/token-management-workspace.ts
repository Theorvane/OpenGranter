import type { CatalogAuthorityGrant } from './catalog-authority.ts';
import {
  createManagementTokenAuthority,
  type TokenAuthorityOptions,
} from './token-management-authority.ts';

export interface TokenWorkspaceOptions extends Omit<TokenAuthorityOptions, 'onInvalidate'> {
  /** Read snapshot to render. No credential is passed to notifications. */
  readonly onChange?: () => void;
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
    generation++;
    if (busy) uncertain = true;
    secret = undefined;
    const old = authority;
    authority = undefined;
    old?.dispose();
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
    if (!authority?.isActive()) return { state } as { readonly state: 'expired' | 'disposed' };
    const current = authority;
    const epoch = generation;
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
      detach();
      state = 'ready';
      const epoch = generation;
      authority = createManagementTokenAuthority(grant, {
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
      notify();
    },
    logout() {
      detach();
      state = 'disposed';
      notify();
    },
    hideSecret() {
      if (busy) {
        detach();
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
