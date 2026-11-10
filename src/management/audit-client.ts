import { parseAuditHistoryQuery, projectAuditHistoryPage } from '../audit/history-http.ts';
import type { AuditHistoryEvent, AuditHistoryPage } from '../audit/postgres-audit-history.ts';
import type { CatalogRequest } from './catalog-client.ts';

export interface AuditFilters {
  readonly principalId: string;
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
const MAX_BYTES = 2 * 1024 * 1024;

function query(filters: AuditFilters): string | undefined {
  if (typeof filters.principalId !== 'string') return undefined;
  const params = new URLSearchParams({ format: 'json', principal_id: filters.principalId });
  if (filters.model !== undefined) {
    if (typeof filters.model !== 'string') return undefined;
    params.set('model', filters.model);
  }
  for (const [key, value] of [
    ['from_ms', filters.fromMs],
    ['to_ms', filters.toMs],
    ['limit', filters.limit],
  ] as const) {
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined;
      params.set(key, String(value));
    }
  }
  if (filters.cursor !== undefined) {
    if (typeof filters.cursor !== 'string') return undefined;
    params.set('cursor', filters.cursor);
  }
  parseAuditHistoryQuery(new URL(`/v1/audit?${params}`, 'https://local.invalid'));
  return params.toString();
}

function parsePage(value: unknown, filters: AuditFilters) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid page');
  const input = value as Record<string, unknown>;
  if (
    input.object !== 'list' ||
    !Array.isArray(input.data) ||
    typeof input.has_more !== 'boolean' ||
    (input.has_more ? typeof input.next_cursor !== 'string' : input.next_cursor !== null)
  )
    throw new Error('Invalid page');
  // The shared projector validates all untrusted event fields and returns owned allowlisted metadata.
  const page = projectAuditHistoryPage(
    { events: input.data, nextCursor: input.next_cursor } as AuditHistoryPage,
    filters.principalId,
    filters.limit ?? 50,
    filters.cursor ?? null,
    {
      ...(filters.model === undefined ? {} : { modelAlias: filters.model }),
      ...(filters.fromMs === undefined ? {} : { fromMs: filters.fromMs }),
      ...(filters.toMs === undefined ? {} : { toMs: filters.toMs }),
    },
  );
  return { data: page.events, hasMore: page.nextCursor !== null, nextCursor: page.nextCursor };
}

/** Metadata-only audit transport, not authentication. Host must invalidate on identity/expiry change.
 * Uses the existing gateway endpoint, not an unapproved SSO management route.
 */
function discard(response: Response) {
  void response.body?.cancel().catch(() => undefined);
}
async function boundedJson(response: Response, signal: AbortSignal): Promise<string> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/u.test(length) || Number(length) > MAX_BYTES)) {
    discard(response);
    throw new Error('Invalid audit length');
  }
  if (!response.body) throw new Error('Missing audit body');
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
      if (size > MAX_BYTES) throw new Error('Audit page exceeds limit');
      text.push(decoder.decode(value, { stream: true }));
    }
    // Fetch exposes decoded bytes; compressed wire lengths are not comparable.
    const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
    if (length !== null && (!encoding || encoding === 'identity') && size !== Number(length)) {
      throw new Error('Incomplete audit body');
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

export function createAuditHistoryClient(request: CatalogRequest) {
  let pending: AbortController | undefined;
  function invalidate() {
    pending?.abort();
    pending = undefined;
  }
  return {
    invalidate,
    async read(filters: AuditFilters): Promise<AuditResult> {
      invalidate();
      let snapshot: AuditFilters;
      let search: string | undefined;
      try {
        snapshot = { ...filters };
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
          const response = await request(`/v1/audit?${search}`, {
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
