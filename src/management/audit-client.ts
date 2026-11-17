import { parseAuditHistoryQuery, projectAuditHistoryPage } from '../shared/audit/history-http.ts';
import type { AuditHistoryEvent } from '../shared/audit/history-types.ts';
import type { CatalogRequest } from './catalog-client.ts';

export interface AuditFilters {
  readonly principalId?: string;
  readonly requestId?: string;
  readonly model?: string;
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly limit?: number;
  readonly cursor?: string;
}
export type AuditResult =
  | {
      readonly state: 'ready';
      readonly data: readonly AuditHistoryEvent[];
      readonly hasMore: boolean;
      readonly nextCursor: string | null;
    }
  | {
      readonly state: 'invalid_query' | 'unauthenticated' | 'denied' | 'unavailable' | 'cancelled';
    };

function query(filters: AuditFilters, format: 'json' | 'csv' = 'json'): string | undefined {
  const params = new URLSearchParams({ format });
  for (const [field, parameter] of [
    ['principalId', 'principal_id'],
    ['requestId', 'request_id'],
    ['model', 'model'],
    ['cursor', 'cursor'],
  ] as const) {
    const value = filters[field];
    if (value !== undefined) {
      if (typeof value !== 'string') return undefined;
      params.set(parameter, value);
    }
  }
  for (const [field, parameter] of [
    ['fromMs', 'from_ms'],
    ['toMs', 'to_ms'],
    ['limit', 'limit'],
  ] as const) {
    const value = filters[field];
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) return undefined;
      params.set(parameter, String(value));
    }
  }
  parseAuditHistoryQuery(new URL(`https://audit.invalid/?${params}`));
  return params.toString();
}

const MAX_BYTES = 2 * 1024 * 1024;
function discard(response: Response) {
  void response.body?.cancel().catch(() => undefined);
}
async function boundedText(response: Response, signal: AbortSignal): Promise<string> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/u.test(length) || Number(length) > MAX_BYTES)) {
    discard(response);
    throw new Error('Invalid export length');
  }
  if (!response.body) throw new Error('Missing export body');
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  let size = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const text: string[] = [];
  try {
    if (signal.aborted) throw new Error('Interrupted');
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error('Interrupted');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Export exceeds limit');
      text.push(decoder.decode(value, { stream: true }));
    }
    // Fetch exposes decoded bytes, not the compressed wire length.
    const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
    if (length !== null && (!encoding || encoding === 'identity') && size !== Number(length)) {
      throw new Error('Incomplete response body');
    }
    text.push(decoder.decode());
    return text.join('');
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

function parsePage(value: unknown, filters: AuditFilters) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid audit page');
  const page = value as Record<string, unknown>;
  if (
    page.object !== 'list' ||
    !Array.isArray(page.data) ||
    typeof page.has_more !== 'boolean' ||
    (page.has_more ? typeof page.next_cursor !== 'string' : page.next_cursor !== null)
  )
    throw new Error('Invalid audit page');
  const parsed = parseAuditHistoryQuery(new URL(`https://audit.invalid/?${query(filters)}`));
  // With no explicit principal the server resolves the caller. Check internal page
  // consistency, never infer authorization or identity from a response row.
  const first: unknown = page.data[0];
  const target =
    parsed.requestedPrincipalId ??
    (typeof first === 'object' &&
    first !== null &&
    'principalId' in first &&
    typeof first.principalId === 'string'
      ? first.principalId
      : '');
  const projected = projectAuditHistoryPage(
    { events: page.data as AuditHistoryEvent[], nextCursor: page.next_cursor as string | null },
    target,
    parsed.limit,
    parsed.cursor,
    parsed,
  );
  return { data: projected.events, hasMore: page.has_more, nextCursor: projected.nextCursor };
}

/** One already-authorized metadata page; no session, DOM, credential handling or cache.
 * Invalidate and drop prior data on identity change. The server remains authoritative.
 */
type AuditFailure = Exclude<AuditResult, { readonly state: 'ready' }>;
export type AuditExportResult =
  | {
      readonly state: 'ready';
      readonly csv: string;
      readonly hasMore: boolean;
      readonly nextCursor: string | null;
    }
  | AuditFailure;

function createAuditTransport<T>(
  request: CatalogRequest,
  format: 'json' | 'csv',
  project: (response: Response, text: string, filters: AuditFilters) => T,
) {
  let pending: AbortController | undefined;
  function invalidate() {
    pending?.abort();
    pending = undefined;
  }
  return {
    invalidate,
    async read(filters: AuditFilters = {}): Promise<T | AuditFailure> {
      invalidate();
      let search: string | undefined;
      let snapshot: AuditFilters;
      try {
        // Bind response validation to the exact filters serialized for this request.
        const { principalId, requestId, model, fromMs, toMs, limit, cursor } = filters;
        snapshot = {
          ...(principalId === undefined ? {} : { principalId }),
          ...(requestId === undefined ? {} : { requestId }),
          ...(model === undefined ? {} : { model }),
          ...(fromMs === undefined ? {} : { fromMs }),
          ...(toMs === undefined ? {} : { toMs }),
          ...(limit === undefined ? {} : { limit }),
          ...(cursor === undefined ? {} : { cursor }),
        };
        search = query(snapshot, format);
      } catch {
        return { state: 'invalid_query' };
      }
      if (search === undefined) return { state: 'invalid_query' };
      const controller = new AbortController();
      pending = controller;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 15_000);
      const interrupted = (): AuditFailure => ({
        state: timedOut ? 'unavailable' : 'cancelled',
      });
      let onAbort: (() => void) | undefined;
      const interruption = new Promise<T | AuditFailure>((resolve) => {
        onAbort = () => resolve(interrupted());
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const operation = async (): Promise<T | AuditFailure> => {
        try {
          const response = await request(`/management/v1/audit?${search}`, {
            method: 'GET',
            cache: 'no-store',
            redirect: 'error',
            headers: { accept: format === 'json' ? 'application/json' : 'text/csv' },
            signal: controller.signal,
          });
          if (controller.signal.aborted) {
            discard(response);
            return interrupted();
          }
          if (response.status !== 200) {
            discard(response);
            if (response.status === 400) return { state: 'invalid_query' };
            if (response.status === 401) return { state: 'unauthenticated' };
            if (response.status === 403) return { state: 'denied' };
            return { state: 'unavailable' };
          }
          if (
            !(
              format === 'json'
                ? /^application\/json(?:;\s*charset=utf-8)?$/iu
                : /^text\/csv(?:;\s*charset=utf-8)?$/iu
            ).test(response.headers.get('content-type') ?? '')
          ) {
            discard(response);
            return { state: 'unavailable' };
          }
          const text = await boundedText(response, controller.signal);
          if (controller.signal.aborted) return interrupted();
          return project(response, text, snapshot);
        } catch {
          return controller.signal.aborted ? interrupted() : { state: 'unavailable' };
        }
      };
      try {
        return await Promise.race([interruption, operation()]);
      } finally {
        clearTimeout(timer);
        if (onAbort) controller.signal.removeEventListener('abort', onAbort);
        if (pending === controller) pending = undefined;
      }
    },
  };
}

/** Authorized JSON metadata page. No session or browser-build activation. */
export function createSsoAuditClient(request: CatalogRequest) {
  return createAuditTransport(
    request,
    'json',
    (_response, text, filters): AuditResult => ({
      state: 'ready',
      ...parsePage(JSON.parse(text), filters),
    }),
  );
}

/** Authorized server CSV page, not reconstructed JSON or an automatic download.
 * Keep the same filters when following the opaque cursor. Invalidate on identity change.
 */
export function createSsoAuditExportClient(request: CatalogRequest) {
  return createAuditTransport(request, 'csv', (response, csv, filters): AuditExportResult => {
    const more = response.headers.get('x-has-more');
    const next = response.headers.get('x-next-cursor');
    if (more !== 'true' && more !== 'false') throw new Error('Missing pagination');
    if (more === 'true') {
      if (next === null) throw new Error('Missing cursor');
      // Reuse the canonical positive PostgreSQL bigint validator, never Number.
      parseAuditHistoryQuery(new URL(`https://audit.invalid/?cursor=${encodeURIComponent(next)}`));
      if (filters.cursor !== undefined && BigInt(next) >= BigInt(filters.cursor)) {
        throw new Error('Nonprogressing cursor');
      }
    } else if (next !== null) {
      throw new Error('Unexpected terminal cursor');
    }
    return { state: 'ready', csv, hasMore: more === 'true', nextCursor: next };
  });
}
