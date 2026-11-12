import { parseAuditHistoryQuery, projectAuditHistoryPage } from '../audit/history-http.ts';
import type { AuditHistoryEvent } from '../audit/postgres-audit-history.ts';
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

function query(filters: AuditFilters): string | undefined {
  const params = new URLSearchParams({ format: 'json' });
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
async function boundedJson(response: Response, signal: AbortSignal): Promise<string> {
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
      throw new Error('Incomplete JSON body');
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
export function createSsoAuditClient(request: CatalogRequest) {
  let pending: AbortController | undefined;
  function invalidate() {
    pending?.abort();
    pending = undefined;
  }
  return {
    invalidate,
    async read(filters: AuditFilters = {}): Promise<AuditResult> {
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
        search = query(snapshot);
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
      const interrupted = (): AuditResult => ({
        state: timedOut ? 'unavailable' : 'cancelled',
      });
      let onAbort: (() => void) | undefined;
      const interruption = new Promise<AuditResult>((resolve) => {
        onAbort = () => resolve(interrupted());
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const operation = async (): Promise<AuditResult> => {
        try {
          const response = await request(`/management/v1/audit?${search}`, {
            method: 'GET',
            cache: 'no-store',
            redirect: 'error',
            headers: { accept: 'application/json' },
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
            !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
              response.headers.get('content-type') ?? '',
            )
          ) {
            discard(response);
            return { state: 'unavailable' };
          }
          const text = await boundedJson(response, controller.signal);
          if (controller.signal.aborted) return interrupted();
          const data = parsePage(JSON.parse(text), snapshot);
          return { state: 'ready', ...data };
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
