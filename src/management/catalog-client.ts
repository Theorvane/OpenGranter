/** Transport only. The caller must supply an already-authorized request port.
 * Never obtains, stores or forwards browser credentials by itself.
 */
export interface CatalogModel {
  readonly id: string;
  readonly object: 'model';
  readonly created: number;
  readonly owned_by: string;
}
export type CatalogResult<T> =
  | { readonly state: 'ready'; readonly data: T }
  | { readonly state: 'unauthenticated' | 'denied' | 'missing' | 'unavailable' | 'cancelled' };
export type CatalogRequestInit = RequestInit & { readonly cache: 'no-store' };
export type CatalogRequest = (path: string, init: CatalogRequestInit) => Promise<Response>;

function model(value: unknown): value is CatalogModel {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    row.object === 'model' &&
    typeof row.created === 'number' &&
    Number.isFinite(row.created) &&
    typeof row.owned_by === 'string'
  );
}
function project(row: CatalogModel): CatalogModel {
  return { id: row.id, object: 'model', created: row.created, owned_by: row.owned_by };
}

/** A new read supersedes the previous read; invalidate on identity/session change.
 * No cache, persistence, provider calls, response error text or token handling.
 */
export function createManagementCatalogClient(request: CatalogRequest) {
  let revision = 0;
  let pending: AbortController | undefined;
  function invalidate() {
    revision += 1;
    pending?.abort();
    pending = undefined;
  }
  async function read<T>(
    path: string,
    decode: (body: unknown) => T | undefined,
  ): Promise<CatalogResult<T>> {
    invalidate();
    const current = revision;
    const controller = new AbortController();
    pending = controller;
    const stale = () => current !== revision || controller.signal.aborted;
    try {
      const response = await request(path, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (stale()) return { state: 'cancelled' };
      if (response.status === 401) return { state: 'unauthenticated' };
      if (response.status === 403) return { state: 'denied' };
      if (response.status === 404) return { state: 'missing' };
      if (response.status !== 200) return { state: 'unavailable' };
      const body: unknown = await response.json();
      if (stale()) return { state: 'cancelled' };
      const data = decode(body);
      return data === undefined ? { state: 'unavailable' } : { state: 'ready', data };
    } catch {
      return { state: stale() ? 'cancelled' : 'unavailable' };
    } finally {
      if (current === revision) pending = undefined;
    }
  }
  return {
    invalidate,
    list: () =>
      read('/api/v1/models', (body): readonly CatalogModel[] | undefined => {
        if (
          typeof body !== 'object' ||
          body === null ||
          !('data' in body) ||
          !Array.isArray(body.data) ||
          !body.data.every(model)
        )
          return undefined;
        return body.data.map(project);
      }),
    detail: (id: string): Promise<CatalogResult<CatalogModel>> => {
      // Reserved compatible collection paths are not model detail operations.
      if (
        !id ||
        id === 'count' ||
        id === 'user' ||
        id.length > 512 ||
        /[\s%\\?#]/u.test(id) ||
        Array.from(id).some((char) => {
          const code = char.charCodeAt(0);
          return code < 32 || (code >= 127 && code <= 159);
        }) ||
        id.split('/').some((part) => !part || part === '.' || part === '..')
      ) {
        invalidate();
        return Promise.resolve({ state: 'unavailable' });
      }
      let encoded: string;
      try {
        encoded = encodeURIComponent(id);
      } catch {
        invalidate();
        return Promise.resolve({ state: 'unavailable' });
      }
      return read(`/api/v1/models/${encoded}`, (body) =>
        model(body) && body.id === id ? project(body) : undefined,
      );
    },
  };
}
