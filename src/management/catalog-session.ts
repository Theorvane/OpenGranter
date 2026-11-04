import {
  type CatalogModel,
  type CatalogRequest,
  type CatalogResult,
  createManagementCatalogClient,
} from './catalog-client.ts';

type LockedState = 'unauthenticated' | 'expired' | 'denied' | 'unavailable';
export type ManagementCatalogSnapshot =
  | { readonly state: LockedState | 'idle' | 'empty' | 'missing' | 'disposed' }
  | { readonly state: 'loading'; readonly view: 'list' | 'detail' }
  | { readonly state: 'list'; readonly models: readonly CatalogModel[] }
  | { readonly state: 'detail'; readonly model: CatalogModel };

/** UI-independent lifecycle, not an authenticator. Only a trusted session adapter
 * may supply authority. Call clear on session teardown and re-render immediately.
 * Each navigation replaces prior content; no credential or identity is persisted.
 */
export function createManagementCatalogSession() {
  let client: ReturnType<typeof createManagementCatalogClient> | undefined;
  let revision = 0;
  let disposed = false;
  let snapshot: ManagementCatalogSnapshot = { state: 'unauthenticated' };

  function invalidate() {
    revision++;
    client?.invalidate();
    client = undefined;
  }
  function clear(state: LockedState) {
    if (disposed) return;
    invalidate();
    snapshot = Object.freeze({ state });
  }
  async function read<T>(
    view: 'list' | 'detail',
    operation: (active: NonNullable<typeof client>) => Promise<CatalogResult<T>>,
    ready: (data: T) => ManagementCatalogSnapshot,
  ): Promise<void> {
    if (!client || disposed) return;
    const active = client;
    const current = ++revision;
    snapshot = Object.freeze({ state: 'loading', view });
    const result = await operation(active);
    if (current !== revision || disposed) return;
    if (result.state === 'ready') snapshot = Object.freeze(ready(result.data));
    else if (result.state === 'unauthenticated' || result.state === 'denied') clear(result.state);
    else
      snapshot = Object.freeze({
        state: result.state === 'cancelled' ? 'unavailable' : result.state,
      });
  }
  return {
    snapshot: (): ManagementCatalogSnapshot => snapshot,
    /** Every call starts a new identity epoch, including the same request port. */
    authorize(request: CatalogRequest) {
      if (disposed) return;
      invalidate();
      client = createManagementCatalogClient(request);
      snapshot = Object.freeze({ state: 'idle' });
    },
    clear,
    list: () =>
      read(
        'list',
        (active) => active.list(),
        (models) =>
          models.length === 0
            ? { state: 'empty' }
            : { state: 'list', models: Object.freeze(models.map((model) => Object.freeze(model))) },
      ),
    detail: (id: string) =>
      read(
        'detail',
        (active) => active.detail(id),
        (model) => ({ state: 'detail', model: Object.freeze(model) }),
      ),
    dispose() {
      if (disposed) return;
      invalidate();
      disposed = true;
      snapshot = Object.freeze({ state: 'disposed' });
    },
  };
}
