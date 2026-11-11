import type { UsageRecord } from '../usage/record-usage.ts';
import type { CatalogRequest } from './catalog-client.ts';
import { createSsoUsageClient, type UsageFilters } from './usage-client.ts';

type LockedState = 'unauthenticated' | 'expired' | 'denied' | 'unavailable';
export type UsageSearch = Omit<UsageFilters, 'cursor'>;
export type UsageSnapshot =
  | { readonly state: LockedState | 'idle' | 'loading' | 'empty' | 'invalid_query' | 'disposed' }
  | {
      readonly state: 'rows';
      readonly data: readonly UsageRecord[];
      readonly hasMore: boolean;
    };

function freeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

/** Read-only lifecycle, NOT authentication. Trusted caller must clear immediately
 * on logout, identity change or expiry. Server enforces fresh identity and IAM.
 * No identity, credentials or previous pages are retained across epochs.
 */
export function createSsoUsageSession() {
  let client: ReturnType<typeof createSsoUsageClient> | undefined;
  let snapshot: UsageSnapshot = Object.freeze({ state: 'unauthenticated' });
  let filters: UsageSearch = {};
  let cursor: string | undefined;
  let retryQuery: UsageFilters | undefined;
  let revision = 0;
  let disposed = false;

  function invalidate() {
    revision++;
    client?.invalidate();
    client = undefined;
    filters = {};
    cursor = undefined;
    retryQuery = undefined;
  }
  function clear(state: LockedState) {
    if (disposed) return;
    invalidate();
    snapshot = Object.freeze({ state });
  }
  async function read(query: UsageFilters) {
    if (!client || disposed) return;
    const active = client;
    const current = ++revision;
    cursor = undefined;
    retryQuery = undefined;
    snapshot = Object.freeze({ state: 'loading' });
    const result = await active.read(query);
    if (current !== revision || disposed) return;
    if (result.state === 'ready') {
      cursor = result.nextCursor ?? undefined;
      // Transport validated and copied these records; freeze owned data only.
      freeze(result.data);
      snapshot =
        result.data.length === 0
          ? Object.freeze({ state: 'empty' })
          : Object.freeze({ state: 'rows', data: result.data, hasMore: result.hasMore });
    } else if (result.state === 'unauthenticated' || result.state === 'denied') {
      clear(result.state);
    } else {
      if (result.state === 'unavailable') retryQuery = query;
      snapshot = Object.freeze({
        state: result.state === 'cancelled' ? 'unavailable' : result.state,
      });
    }
  }
  return {
    snapshot: (): UsageSnapshot => snapshot,
    /** Every call is a fresh epoch, even if the request port is unchanged. */
    authorize(request: CatalogRequest) {
      if (disposed) return;
      invalidate();
      client = createSsoUsageClient(request);
      snapshot = Object.freeze({ state: 'idle' });
    },
    clear,
    async search(search: UsageSearch = {}) {
      if (!client || disposed) return;
      // Copy explicitly: never retain mutable caller input or a caller cursor.
      filters = {
        ...(search.principalId !== undefined ? { principalId: search.principalId } : {}),
        ...(search.model !== undefined ? { model: search.model } : {}),
        ...(search.fromMs !== undefined ? { fromMs: search.fromMs } : {}),
        ...(search.toMs !== undefined ? { toMs: search.toMs } : {}),
        ...(search.limit !== undefined ? { limit: search.limit } : {}),
      };
      await read(filters);
    },
    async next() {
      if (!client || disposed || snapshot.state !== 'rows' || !cursor) return;
      await read({ ...filters, cursor });
    },
    async retry() {
      if (!client || disposed || snapshot.state !== 'unavailable' || !retryQuery) return;
      // Reuse only the failed query, including its opaque continuation; never old rows.
      await read(retryQuery);
    },
    dispose() {
      if (disposed) return;
      invalidate();
      disposed = true;
      snapshot = Object.freeze({ state: 'disposed' });
    },
  };
}
