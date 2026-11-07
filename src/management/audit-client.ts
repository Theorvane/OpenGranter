import { projectGatewayAuditEvent } from '../audit/gateway-event-projection.ts';
import { parseAuditHistoryQuery, projectAuditHistoryPage } from '../audit/history-projection.ts';
import type { AuditHistoryEvent, AuditHistoryPage } from '../audit/postgres-audit-history.ts';
import type { CatalogRequest } from './catalog-client.ts';

export interface AuditFilters {
  readonly principalId?: string;
  readonly model?: string;
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly limit?: number;
  readonly cursor?: string;
}
export type AuditClientResult =
  | { readonly state: 'ready'; readonly data: AuditHistoryPage }
  | {
      readonly state: 'invalid_query' | 'unauthenticated' | 'denied' | 'unavailable' | 'cancelled';
    };

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw Error('Invalid data');
  return value as Record<string, unknown>;
}
function event(value: unknown): AuditHistoryEvent {
  const input = object(value);
  if (typeof input.eventId !== 'string' || typeof input.occurredAt !== 'number')
    throw Error('Invalid event');
  const projected = projectGatewayAuditEvent(
    {
      ...object(input.details),
      kind: input.kind,
      requestId: input.requestId,
      principalId: input.principalId,
      credentialId: input.credentialId,
      policyVersions: input.policyVersions,
    },
    input.occurredAt,
  );
  if (
    projected.principalId === null ||
    projected.credentialId === null ||
    projected.policyVersions === null
  )
    throw Error('Invalid attribution');
  return {
    eventId: input.eventId,
    occurredAt: projected.occurredAt,
    kind: projected.kind,
    requestId: projected.requestId,
    principalId: projected.principalId,
    credentialId: projected.credentialId,
    policyVersions: projected.policyVersions,
    details: projected.details,
  };
}
function discard(response: Response) {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    /* Private cleanup only. */
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
      /* Best effort. */
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

/** Existing proxy audit API only. A supplied port is not browser login or SSO. */
export function createManagementAuditClient(request: CatalogRequest) {
  let pending: AbortController | undefined;
  let revision = 0;
  function invalidate() {
    revision++;
    pending?.abort();
    pending = undefined;
  }
  async function list(filters: AuditFilters = {}): Promise<AuditClientResult> {
    invalidate();
    const url = new URL('https://audit.invalid/v1/audit');
    for (const [key, value] of [
      ['principal_id', filters.principalId],
      ['model', filters.model],
      ['from_ms', filters.fromMs],
      ['to_ms', filters.toMs],
      ['limit', filters.limit],
      ['cursor', filters.cursor],
    ] as const)
      if (value !== undefined) url.searchParams.set(key, String(value));
    url.searchParams.set('format', 'json');
    let query: ReturnType<typeof parseAuditHistoryQuery>;
    try {
      query = parseAuditHistoryQuery(url);
    } catch {
      return { state: 'invalid_query' };
    }
    const current = revision;
    const controller = new AbortController();
    pending = controller;
    const stale = () => current !== revision || controller.signal.aborted;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const interrupted = new Promise<AuditClientResult>((resolve) => {
      onAbort = () => resolve({ state: timedOut ? 'unavailable' : 'cancelled' });
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 30_000);
    });
    const operation = async (): Promise<AuditClientResult> => {
      try {
        const response = await request(url.pathname + url.search, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (stale()) {
          discard(response);
          return { state: 'cancelled' };
        }
        if (response.status !== 200) {
          discard(response);
          const state =
            response.status === 400
              ? 'invalid_query'
              : response.status === 401
                ? 'unauthenticated'
                : response.status === 403
                  ? 'denied'
                  : 'unavailable';
          return { state };
        }
        if (
          response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
          'application/json'
        ) {
          discard(response);
          return { state: 'unavailable' };
        }
        const raw = await boundedText(response, controller.signal);
        if (stale()) return { state: 'cancelled' };
        const body = object(JSON.parse(raw));
        if (
          body.object !== 'list' ||
          !Array.isArray(body.data) ||
          typeof body.has_more !== 'boolean' ||
          !(body.next_cursor === null || typeof body.next_cursor === 'string') ||
          body.has_more !== (body.next_cursor !== null)
        )
          throw Error('Invalid page');
        const events = body.data.map(event);
        const target = query.requestedPrincipalId ?? events[0]?.principalId;
        if (target === undefined) {
          if (body.next_cursor !== null) throw Error('Invalid empty page');
          return { state: 'ready', data: { events: [], nextCursor: null } };
        }
        const data = projectAuditHistoryPage(
          { events, nextCursor: body.next_cursor },
          target,
          query.limit,
          query.cursor,
          query,
        );
        return { state: 'ready', data };
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
  return { list, invalidate };
}
