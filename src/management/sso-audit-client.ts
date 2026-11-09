import { parseAuditHistoryQuery, projectAuditHistoryPage } from '../audit/history-http.ts';
import type { AuditHistoryPage } from '../audit/postgres-audit-history.ts';
import { validAuditPrincipalReference } from '../audit/principal-reference.ts';
import type { CatalogRequest } from './catalog-client.ts';

export interface SsoAuditFilters {
  readonly requestId?: string;
  readonly principalId?: string;
  readonly model?: string;
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly limit?: number;
  readonly cursor?: string;
}
export type SsoAuditClientResult<T> =
  | { readonly state: 'ready'; readonly data: T }
  | {
      readonly state: 'unauthenticated' | 'denied' | 'invalid_query' | 'unavailable' | 'cancelled';
    };
export interface SsoAuditPage extends AuditHistoryPage {
  readonly hasMore: boolean;
}
export interface SsoAuditCsvPage {
  readonly csv: string;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}
function query(filters: SsoAuditFilters, format: 'json' | 'csv') {
  const params = new URLSearchParams();
  for (const [key, value] of [
    ['principal_id', filters.principalId],
    ['request_id', filters.requestId],
    ['model', filters.model],
    ['from_ms', filters.fromMs],
    ['to_ms', filters.toMs],
    ['limit', filters.limit],
    ['cursor', filters.cursor],
  ] as const) {
    if (value !== undefined) {
      if (typeof value !== (['from_ms', 'to_ms', 'limit'].includes(key) ? 'number' : 'string'))
        throw Error('Invalid filter');
      params.set(key, String(value));
    }
  }
  params.set('format', format);
  const path = `/management/v1/audit?${params}`;
  return { path, parsed: parseAuditHistoryQuery(new URL(path, 'https://management.invalid')) };
}
function paging(response: Response, cursor: string | null) {
  const more = response.headers.get('x-audit-has-more');
  const next = response.headers.get('x-audit-next-cursor');
  if ((more !== 'true' && more !== 'false') || (more === 'true') !== (next !== null))
    throw Error('Invalid paging');
  if (next !== null) {
    parseAuditHistoryQuery(
      new URL(`https://management.invalid/?cursor=${encodeURIComponent(next)}`),
    );
    if (cursor !== null && BigInt(next) >= BigInt(cursor)) throw Error('Invalid paging');
  }
  return { hasMore: more === 'true', nextCursor: next };
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

/** Explicit transport, not an authority source. Caller invalidates on every authority change. */
export function createManagementSsoAuditClient(request: CatalogRequest, principalId: string) {
  if (!validAuditPrincipalReference(principalId)) throw Error('Invalid current principal');
  let revision = 0;
  let pending: AbortController | undefined;
  function invalidate() {
    revision++;
    pending?.abort();
    pending = undefined;
  }
  async function read<T>(
    filters: SsoAuditFilters,
    format: 'json' | 'csv',
    decode: (
      text: string,
      response: Response,
      parsed: ReturnType<typeof parseAuditHistoryQuery>,
    ) => T,
  ): Promise<SsoAuditClientResult<T>> {
    invalidate();
    let captured: ReturnType<typeof query>;
    try {
      captured = query(filters, format);
    } catch {
      return { state: 'invalid_query' };
    }
    const current = revision;
    const controller = new AbortController();
    pending = controller;
    const stale = () => revision !== current || controller.signal.aborted;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const interrupted = new Promise<SsoAuditClientResult<T>>((resolve) => {
      onAbort = () => resolve({ state: timedOut ? 'unavailable' : 'cancelled' });
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 30_000);
    });
    const operation = async (): Promise<SsoAuditClientResult<T>> => {
      try {
        const response = await request(captured.path, {
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
        return { state: 'ready', data: decode(raw, response, captured.parsed) };
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
    list: (filters: SsoAuditFilters = {}) =>
      read(filters, 'json', (raw, response, parsed): SsoAuditPage => {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw Error('Invalid page');
        const body = value as Record<string, unknown>;
        if (
          body.object !== 'list' ||
          !Array.isArray(body.data) ||
          (body.next_cursor !== null && typeof body.next_cursor !== 'string')
        )
          throw Error('Invalid page');
        const page = projectAuditHistoryPage(
          { events: body.data, nextCursor: body.next_cursor } as AuditHistoryPage,
          parsed.requestedPrincipalId ?? principalId,
          parsed.limit,
          parsed.cursor,
          parsed,
        );
        const headers = paging(response, parsed.cursor);
        if (headers.nextCursor !== page.nextCursor) throw Error('Invalid paging');
        return { ...page, hasMore: headers.hasMore };
      }),
    csv: (filters: SsoAuditFilters = {}) =>
      read(
        filters,
        'csv',
        (csv, response, parsed): SsoAuditCsvPage => ({
          csv,
          ...paging(response, parsed.cursor),
        }),
      ),
  };
}
