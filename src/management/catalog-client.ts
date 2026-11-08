/** Transport only. The caller must supply an already-authorized request port.
 * Never obtains, stores or forwards browser credentials by itself.
 */
export interface CatalogModel {
  readonly id: string;
  readonly object: 'model';
  readonly created: number;
  readonly owned_by: string;
  /** Already-published informational text only; never render as HTML. */
  readonly name?: string;
  readonly description?: string;
  /** Null means unknown; omission is a legacy/basic publication. */
  readonly context_length?: number | null;
  /** Published base rates only; not discounted or billed request costs. */
  readonly pricing?: { readonly prompt: string; readonly completion: string };
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
    (!Object.hasOwn(row, 'pricing') || basePricing(row.pricing)) &&
    (!Object.hasOwn(row, 'name') ||
      (typeof row.name === 'string' && row.name.trim().length > 0 && row.name.length <= 256)) &&
    (!Object.hasOwn(row, 'description') ||
      (typeof row.description === 'string' && row.description.length <= 8192)) &&
    (!Object.hasOwn(row, 'context_length') ||
      row.context_length === null ||
      (typeof row.context_length === 'number' &&
        Number.isSafeInteger(row.context_length) &&
        row.context_length >= 0)) &&
    typeof row.owned_by === 'string'
  );
}
function basePricing(value: unknown): value is NonNullable<CatalogModel['pricing']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return [row.prompt, row.completion].every(
    (price) =>
      typeof price === 'string' &&
      price.length <= 128 &&
      /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u.test(price) &&
      Number.isFinite(Number(price)),
  );
}

function discard(response: Response) {
  // Do not consume private errors or await an uncooperative stream cancellation.
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    // Cleanup failure cannot change the safe status or expose response text.
  }
}

// A UI resource bound, not a server-side catalog size or pagination contract.
const MAX_CATALOG_BYTES = 1_048_576;
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_CATALOG_BYTES) {
    discard(response);
    throw new Error('Catalog body exceeds limit');
  }
  if (!response.body) throw new Error('Missing catalog body');
  const reader = response.body.getReader();
  const cancel = () => {
    try {
      void reader.cancel().catch(() => {});
    } catch {
      // Cleanup cannot delay a safe result or expose private errors.
    }
  };
  signal.addEventListener('abort', cancel, { once: true });
  const bytes = new Uint8Array(MAX_CATALOG_BYTES);
  let size = 0;
  try {
    if (signal.aborted) throw new Error('Catalog read interrupted');
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error('Catalog read interrupted');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CATALOG_BYTES) throw new Error('Catalog body exceeds limit');
      bytes.set(value, size - value.byteLength);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

function project(row: CatalogModel): CatalogModel {
  return {
    id: row.id,
    object: 'model',
    created: row.created,
    owned_by: row.owned_by,
    ...(row.name === undefined ? {} : { name: row.name }),
    ...(row.description === undefined ? {} : { description: row.description }),
    ...(row.context_length === undefined ? {} : { context_length: row.context_length }),
    ...(row.pricing === undefined
      ? {}
      : {
          pricing: Object.freeze({
            prompt: row.pricing.prompt,
            completion: row.pricing.completion,
          }),
        }),
  };
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let timedOut = false;
    const interrupted = new Promise<CatalogResult<T>>((resolve) => {
      onAbort = () => resolve({ state: timedOut ? 'unavailable' : 'cancelled' });
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 30_000);
    });
    const operation = async (): Promise<CatalogResult<T>> => {
      try {
        const response = await request(path, {
          method: 'GET',
          cache: 'no-store',
          redirect: 'error',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (stale()) {
          discard(response);
          return { state: 'cancelled' };
        }
        if (response.status !== 200) discard(response);
        if (response.status === 401) return { state: 'unauthenticated' };
        if (response.status === 403) return { state: 'denied' };
        if (response.status === 404) return { state: 'missing' };
        if (response.status !== 200) return { state: 'unavailable' };
        const body: unknown = await boundedJson(response, controller.signal);
        if (stale()) return { state: 'cancelled' };
        const data = decode(body);
        return data === undefined ? { state: 'unavailable' } : { state: 'ready', data };
      } catch {
        return { state: stale() ? 'cancelled' : 'unavailable' };
      }
    };
    try {
      return await Promise.race([interrupted, operation()]);
    } finally {
      clearTimeout(timer);
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
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
