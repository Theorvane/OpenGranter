import { parseAuditHistoryQuery, projectAuditHistoryPage } from '../audit/history-public.ts';
import type { AuditHistoryEvent } from '../audit/postgres-audit-history.ts';
import type { CatalogRequest } from './catalog-client.ts';

export interface AuditFilters {
  readonly principalId?: string;
  readonly model?: string;
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly limit?: number;
  readonly cursor?: string;
}
export interface AuditPaging {
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}
export interface AuditPage extends AuditPaging {
  readonly events: readonly AuditHistoryEvent[];
}
export interface AuditCsvPage extends AuditPaging {
  readonly csv: string;
}
export type AuditClientResult<T> =
  | { readonly state: 'ready'; readonly data: T }
  | {
      readonly state: 'unauthenticated' | 'denied' | 'invalid_query' | 'unavailable' | 'cancelled';
    };

function text(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\p{Cc}]/u.test(value)
  );
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
// Opaque cursor transport validation only: do not decode or fabricate a cursor.
function cursor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,18}$/u.test(value) &&
    BigInt(value) <= 9_223_372_036_854_775_807n
  );
}
function paging(hasMore: unknown, nextCursor: unknown): AuditPaging | undefined {
  if (typeof hasMore !== 'boolean' || (hasMore ? !cursor(nextCursor) : nextCursor !== null)) return;
  return { hasMore, nextCursor: nextCursor as string | null };
}
function path(filters: AuditFilters, format: 'json' | 'csv'): string | undefined {
  if (
    (filters.principalId !== undefined && !text(filters.principalId, 256)) ||
    (filters.model !== undefined && !text(filters.model, 256)) ||
    (filters.fromMs !== undefined && !integer(filters.fromMs)) ||
    (filters.toMs !== undefined && !integer(filters.toMs)) ||
    (filters.fromMs !== undefined &&
      filters.toMs !== undefined &&
      filters.fromMs >= filters.toMs) ||
    (filters.limit !== undefined &&
      (!integer(filters.limit) || filters.limit < 1 || filters.limit > 100)) ||
    (filters.cursor !== undefined && !cursor(filters.cursor))
  )
    return;
  const query = new URLSearchParams();
  for (const [key, value] of [
    ['principal_id', filters.principalId],
    ['model', filters.model],
    ['from_ms', filters.fromMs],
    ['to_ms', filters.toMs],
    ['limit', filters.limit],
    ['cursor', filters.cursor],
  ] as const)
    if (value !== undefined) query.set(key, String(value));
  query.set('format', format);
  const url = `/v1/audit?${query}`;
  try {
    parseAuditHistoryQuery(new URL(url, 'http://audit.invalid'));
  } catch {
    return;
  }
  return url;
}
function discard(response: Response) {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    /* Cleanup never exposes private errors. */
  }
}
const MAX_BYTES = 1_048_576;
async function boundedText(response: Response, signal: AbortSignal): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_BYTES) {
    discard(response);
    throw Error('Response limit');
  }
  if (!response.body) throw Error('Missing response');
  const reader = response.body.getReader();
  const cancel = () => {
    try {
      void reader.cancel().catch(() => {});
    } catch {
      /* Best effort only. */
    }
  };
  signal.addEventListener('abort', cancel, { once: true });
  const bytes = new Uint8Array(MAX_BYTES);
  let size = 0;
  try {
    if (signal.aborted) throw Error('Interrupted');
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw Error('Interrupted');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw Error('Response limit');
      bytes.set(value, size - value.byteLength);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
function jsonPage(raw: string, filters: AuditFilters): AuditPage | undefined {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const body = value as Record<string, unknown>;
  const page = paging(body.has_more, body.next_cursor);
  const limit = filters.limit ?? 50;
  if (
    !page ||
    body.object !== 'list' ||
    !Array.isArray(body.data) ||
    body.data.length > limit ||
    (page.hasMore && body.data.length === 0)
  )
    return;
  if (body.data.length === 0) return { events: [], ...page };
  // The first row is only a consistency check for a self query, not an identity
  // or permission grant. Server IAM must freshly determine the target principal.
  const target = filters.principalId ?? body.data[0]?.principalId;
  if (typeof target !== 'string') return;
  const projected = projectAuditHistoryPage(
    { events: body.data, nextCursor: page.nextCursor },
    target,
    limit,
    filters.cursor ?? null,
    {
      ...(filters.fromMs === undefined ? {} : { fromMs: filters.fromMs }),
      ...(filters.toMs === undefined ? {} : { toMs: filters.toMs }),
      ...(filters.model === undefined ? {} : { modelAlias: filters.model }),
    },
  );
  return { events: projected.events, ...page };
}

/** Caller supplies fresh authority and invalidates on logout/expiry/principal change.
 * No credentials, persistence, provider calls or automatic all-pages export.
 */
export function createManagementAuditClient(request: CatalogRequest) {
  let revision = 0;
  let pending: AbortController | undefined;
  function invalidate() {
    revision++;
    pending?.abort();
    pending = undefined;
  }
  async function read<T>(
    filters: AuditFilters,
    format: 'json' | 'csv',
    decode: (text: string, response: Response) => T | undefined,
  ): Promise<AuditClientResult<T>> {
    invalidate();
    const url = path(filters, format);
    if (!url) return { state: 'invalid_query' };
    const current = revision;
    const controller = new AbortController();
    pending = controller;
    const stale = () => revision !== current || controller.signal.aborted;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const interrupted = new Promise<AuditClientResult<T>>((resolve) => {
      onAbort = () => resolve({ state: timedOut ? 'unavailable' : 'cancelled' });
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 30_000);
    });
    const operation = async (): Promise<AuditClientResult<T>> => {
      try {
        const response = await request(url, {
          method: 'GET',
          cache: 'no-store',
          redirect: 'error',
          credentials: 'omit',
          headers: { accept: format === 'json' ? 'application/json' : 'text/csv' },
          signal: controller.signal,
        });
        if (stale()) {
          discard(response);
          return { state: 'cancelled' };
        }
        if (response.status !== 200) {
          discard(response);
          switch (response.status) {
            case 400:
              return { state: 'invalid_query' };
            case 401:
              return { state: 'unauthenticated' };
            case 403:
              return { state: 'denied' };
            default:
              return { state: 'unavailable' };
          }
        }
        const media = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        if (media !== (format === 'json' ? 'application/json' : 'text/csv')) {
          discard(response);
          return { state: 'unavailable' };
        }
        const raw = await boundedText(response, controller.signal);
        if (stale()) return { state: 'cancelled' };
        const data = decode(raw, response);
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
      if (revision === current) pending = undefined;
    }
  }
  return {
    invalidate,
    list: (filters: AuditFilters = {}) => read(filters, 'json', (raw) => jsonPage(raw, filters)),
    csv: (filters: AuditFilters = {}) =>
      read(filters, 'csv', (csv, response): AuditCsvPage | undefined => {
        const more = response.headers.get('x-has-more');
        if (more !== 'true' && more !== 'false') return;
        const page = paging(more === 'true', response.headers.get('x-next-cursor'));
        if (
          !page ||
          (page.nextCursor !== null &&
            filters.cursor !== undefined &&
            BigInt(page.nextCursor) >= BigInt(filters.cursor))
        )
          return;
        return { csv, ...page };
      }),
  };
}
