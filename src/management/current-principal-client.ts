import type { CatalogRequest, CatalogResult } from './catalog-client.ts';

export interface CurrentPrincipal {
  readonly id: string;
  readonly kind: 'human';
}
function decode(value: unknown): CurrentPrincipal | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 2 ||
    !Object.hasOwn(row, 'id') ||
    !Object.hasOwn(row, 'kind') ||
    row.kind !== 'human' ||
    typeof row.id !== 'string' ||
    !row.id.length ||
    row.id.length > 256 ||
    row.id.includes('\0')
  )
    return;
  for (const char of row.id) {
    const code = char.charCodeAt(0);
    if (char.length === 1 && code >= 0xd800 && code <= 0xdfff) return;
  }
  return Object.freeze({ id: row.id, kind: 'human' });
}
function discard(response: Response) {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    /* Best effort. */
  }
}
async function body(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error();
  const cancel = () => {
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      /* Best effort. */
    }
  };
  signal.addEventListener('abort', cancel, { once: true });
  let complete = false;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    let text = '';
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      size += value.byteLength;
      if (size > 4096) throw new Error();
      text += decoder.decode(value, { stream: true });
    }
    if (signal.aborted) throw new Error();
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!complete) cancel();
    try {
      reader.releaseLock();
    } catch {
      /* Best effort. */
    }
  }
}
/** Display-only consumer of a caller-authorized port, never session or IAM authority. */
export function createCurrentPrincipalClient(request: CatalogRequest) {
  let pending: AbortController | undefined;
  function invalidate() {
    pending?.abort();
    pending = undefined;
  }
  return Object.freeze({
    invalidate,
    async read(): Promise<CatalogResult<CurrentPrincipal>> {
      invalidate();
      const controller = new AbortController();
      pending = controller;
      let timedOut = false;
      let onAbort!: () => void;
      const interrupted = new Promise<CatalogResult<CurrentPrincipal>>((resolve) => {
        onAbort = () => resolve({ state: timedOut ? 'unavailable' : 'cancelled' });
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 30_000);
      const operation = async (): Promise<CatalogResult<CurrentPrincipal>> => {
        try {
          const response = await request('/management/v1/principal', {
            method: 'GET',
            cache: 'no-store',
            redirect: 'error',
            headers: { accept: 'application/json' },
            signal: controller.signal,
          });
          if (controller.signal.aborted) {
            discard(response);
            return { state: 'cancelled' };
          }
          if (response.status !== 200) {
            discard(response);
            return {
              state:
                response.status === 401
                  ? 'unauthenticated'
                  : response.status === 403
                    ? 'denied'
                    : 'unavailable',
            };
          }
          if (
            !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
              response.headers.get('content-type') ?? '',
            )
          ) {
            discard(response);
            return { state: 'unavailable' };
          }
          const value = await body(response, controller.signal);
          if (controller.signal.aborted) return { state: 'cancelled' };
          const data = decode(value);
          return data ? { state: 'ready', data } : { state: 'unavailable' };
        } catch {
          return { state: controller.signal.aborted ? 'cancelled' : 'unavailable' };
        }
      };
      try {
        return await Promise.race([interrupted, operation()]);
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        if (pending === controller) pending = undefined;
      }
    },
  });
}
