import { type ManagementBoundaryState, mountManagementBoundaryView } from './boundary-view.ts';
import type { CatalogAuthorityGrant, CatalogAuthorityOptions } from './catalog-authority.ts';
import type { CatalogRequest } from './catalog-client.ts';
import type { CatalogElement } from './catalog-view.ts';
import type { HistoryDownload } from './history-app.ts';
import { mountManagementOperations } from './operations-app.ts';

type LockedState = Exclude<ManagementBoundaryState, 'loading'>;

/** Opt-in consumer of an existing trusted session, never a session authenticator.
 * Caller supplies approved authority and calls clear on logout/identity change.
 * Local clearing cannot revoke a token or roll back an accepted mutation.
 */
export function mountSessionManagementOperations(
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
  let revision = 0;
  let disposed = false;
  let expiresAt: number | undefined;
  let cancel: (() => void) | undefined;
  let child: { dispose(): void } | undefined;

  function invalidate() {
    const current = ++revision;
    expiresAt = undefined;
    const previous = child;
    const cleanup = cancel;
    child = undefined;
    cancel = undefined;
    try {
      previous?.dispose();
    } catch {
      /* Still remove the private subtree. */
    }
    try {
      cleanup?.();
    } catch {
      /* Timer diagnostics are private. */
    }
    return current;
  }
  function clear(state: LockedState = 'unauthenticated') {
    if (disposed) return;
    const current = invalidate();
    if (revision === current) mountManagementBoundaryView(root, state);
  }
  function time() {
    try {
      const value = now();
      return Number.isFinite(value) && value >= 0 ? value : NaN;
    } catch {
      return NaN;
    }
  }
  function valid(current: number) {
    if (disposed || revision !== current || expiresAt === undefined) return false;
    const value = time();
    if (!Number.isFinite(value) || value >= expiresAt) {
      clear('expired');
      return false;
    }
    return true;
  }
  function arm(current: number): boolean {
    if (!valid(current) || expiresAt === undefined) return false;
    const remaining = expiresAt - time();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      clear('expired');
      return false;
    }
    const delay = Math.max(1, Math.min(2147483647, remaining));
    try {
      cancel = schedule(delay, () => {
        if (disposed || current !== revision) return;
        cancel = undefined;
        if (valid(current)) arm(current);
      });
      return valid(current);
    } catch {
      if (revision === current) clear('unavailable');
      return false;
    }
  }
  mountManagementBoundaryView(root, 'unauthenticated');
  return Object.freeze({
    authorize(grant: CatalogAuthorityGrant) {
      if (disposed) return;
      const current = invalidate();
      if (disposed || revision !== current) return;
      const value = time();
      if (
        !Number.isSafeInteger(grant.expiresAt) ||
        !Number.isFinite(value) ||
        grant.expiresAt <= value
      ) {
        mountManagementBoundaryView(root, 'expired');
        return;
      }
      expiresAt = grant.expiresAt;
      if (!arm(current)) return;
      const guarded: CatalogRequest = async (path, init) => {
        if (!valid(current) || init.signal?.aborted) throw new Error('Management session stopped');
        let response: Response;
        try {
          response = await grant.request(path, init);
        } catch {
          valid(current);
          throw new Error('Management request unavailable');
        }
        if (!valid(current) || init.signal?.aborted) {
          // The request port may ignore abort and deliver headers after teardown.
          // No consumer receives this response, so we own its body disposal.
          try {
            void response.body?.cancel().catch(() => {
              /* Source diagnostics must remain private. */
            });
          } catch {
            /* Locked bodies may refuse cancellation; still reject stale data. */
          }
          throw new Error('Management session stopped');
        }
        if (response.status === 401 || response.status === 403) {
          clear(response.status === 401 ? 'unauthenticated' : 'denied');
        }
        if (!response.body) return response;
        const reader = response.body.getReader();
        const stop = async () => {
          try {
            await reader.cancel();
          } catch {
            /* Source diagnostics must remain private. */
          }
        };
        const active = () => valid(current) && !init.signal?.aborted;
        // Do not prefetch: every delivery, including EOF, must check authority
        // after the source read completes, not just when headers arrive.
        const body = new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              try {
                if (!active()) throw new Error('Management session stopped');
                const chunk = await reader.read();
                if (!active()) throw new Error('Management session stopped');
                if (chunk.done) controller.close();
                else controller.enqueue(chunk.value);
              } catch {
                valid(current);
                // Do not wait for a potentially stalled source cancellation.
                void stop();
                controller.error(new Error('Management response unavailable'));
              }
            },
            cancel: stop,
          },
          { highWaterMark: 0 },
        );
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      };
      // Isolate each grant's DOM so reentrant construction/late teardown cannot
      // clear a replacement grant's root or revive detached private content.
      const content = root.ownerDocument.createElement('div');
      root.replaceChildren(content);
      let mounted: { dispose(): void };
      try {
        mounted = mountManagementOperations(content, guarded, createDownload);
      } catch {
        if (revision === current) clear('unavailable');
        return;
      }
      if (valid(current)) child = mounted;
      else {
        try {
          mounted.dispose();
        } catch {
          /* Never expose cleanup diagnostics. */
        }
      }
    },
    clear,
    dispose() {
      if (disposed) return;
      disposed = true;
      const current = invalidate();
      if (revision === current) root.replaceChildren();
    },
  });
}
