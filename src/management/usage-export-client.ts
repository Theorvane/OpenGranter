import type { CatalogRequest } from './catalog-client.ts';

export interface UsageExportFilters {
  readonly principalId?: string;
  readonly model?: string;
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly limit?: number;
  readonly cursor?: string;
}
export type UsageExportResult =
  | {
      readonly state: 'ready';
      readonly csv: string;
      readonly hasMore: boolean;
      readonly nextCursor: string | null;
    }
  | {
      readonly state: 'invalid_query' | 'unauthenticated' | 'denied' | 'unavailable' | 'cancelled';
    };

const MAX_BYTES = 2 * 1024 * 1024;
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function cursorKey(value: unknown): readonly [number, string] | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/u.test(value)) return undefined;
  try {
    const bytes = atob(value.replace(/-/gu, '+').replace(/_/gu, '/'));
    if (btoa(bytes).replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_') !== value)
      return undefined;
    const decoded: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(bytes, (c) => c.charCodeAt(0)),
      ),
    );
    if (
      Array.isArray(decoded) &&
      decoded.length === 2 &&
      count(decoded[0]) &&
      typeof decoded[1] === 'string' &&
      decoded[1].trim().length > 0 &&
      decoded[1].length <= 512
    )
      return [decoded[0], decoded[1]];
  } catch {
    return undefined;
  }
  return undefined;
}
function validCursor(value: unknown): value is string {
  return cursorKey(value) !== undefined;
}
function progresses(next: string, previous: string | null): boolean {
  if (previous === null) return true;
  const before = cursorKey(previous);
  const after = cursorKey(next);
  if (!before || !after) return false;
  if (after[0] !== before[0]) return after[0] < before[0];
  const encoder = new TextEncoder();
  const left = encoder.encode(after[1]);
  const right = encoder.encode(before[1]);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const a = left[i];
    const b = right[i];
    if (a !== undefined && b !== undefined && a !== b) return a < b;
  }
  return left.length < right.length;
}
function query(filters: UsageExportFilters): string | undefined {
  const { principalId, model, fromMs, toMs, limit, cursor } = filters;
  if (
    (principalId !== undefined &&
      (typeof principalId !== 'string' ||
        !principalId.trim() ||
        principalId.length > 256 ||
        Array.from(principalId).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        }))) ||
    (model !== undefined &&
      (typeof model !== 'string' ||
        !model.trim() ||
        model.length > 256 ||
        /\p{Cc}/u.test(model))) ||
    (fromMs !== undefined && !count(fromMs)) ||
    (toMs !== undefined && !count(toMs)) ||
    (fromMs !== undefined && toMs !== undefined && fromMs >= toMs) ||
    (limit !== undefined && (!count(limit) || limit < 1 || limit > 100)) ||
    (cursor !== undefined && !validCursor(cursor))
  )
    return undefined;
  const params = new URLSearchParams({ format: 'csv' });
  if (principalId !== undefined) params.set('principal_id', principalId);
  if (model !== undefined) params.set('model', model);
  if (fromMs !== undefined) params.set('from_ms', String(fromMs));
  if (toMs !== undefined) params.set('to_ms', String(toMs));
  if (limit !== undefined) params.set('limit', String(limit));
  if (cursor !== undefined) params.set('cursor', cursor);
  return params.toString();
}
function discard(response: Response) {
  void response.body?.cancel().catch(() => undefined);
}
async function boundedCsv(response: Response, signal: AbortSignal): Promise<string> {
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
  // CSV is verbatim: expose an existing BOM instead of consuming it.
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
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
    // Fetch exposes decoded bytes; compressed Content-Length describes the wire body.
    const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
    if (length !== null && (!encoding || encoding === 'identity') && size !== Number(length)) {
      throw new Error('Incomplete export body');
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

/** One already-authorized CSV page. No token handling, caching, DOM or automatic download.
 * UI must invalidate on identity/session change and retain filters with opaque cursors.
 * Each new read supersedes the previous one; server remains the permission authority.
 */
export function createSsoUsageExportClient(request: CatalogRequest) {
  let pending: AbortController | undefined;
  function invalidate() {
    pending?.abort();
    pending = undefined;
  }
  return {
    invalidate,
    async read(filters: UsageExportFilters = {}): Promise<UsageExportResult> {
      invalidate();
      let search: string | undefined;
      try {
        search = query(filters);
      } catch {
        return { state: 'invalid_query' };
      }
      if (search === undefined) return { state: 'invalid_query' };
      // Use the exact serialized value, never a mutable caller object after await.
      const requestCursor = new URLSearchParams(search).get('cursor');
      const controller = new AbortController();
      pending = controller;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 15_000);
      const interrupted = (): UsageExportResult => ({
        state: timedOut ? 'unavailable' : 'cancelled',
      });
      let onAbort: (() => void) | undefined;
      const interruption = new Promise<UsageExportResult>((resolve) => {
        onAbort = () => resolve(interrupted());
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const operation = async (): Promise<UsageExportResult> => {
        try {
          const response = await request(`/management/v1/usage?${search}`, {
            method: 'GET',
            cache: 'no-store',
            redirect: 'error',
            headers: { accept: 'text/csv' },
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
          const more = response.headers.get('x-has-more');
          const next = response.headers.get('x-next-cursor');
          if (
            !/^text\/csv(?:;\s*charset=utf-8)?$/iu.test(
              response.headers.get('content-type') ?? '',
            ) ||
            (more !== 'true' && more !== 'false') ||
            (more === 'true'
              ? !validCursor(next) || !progresses(next, requestCursor)
              : next !== null)
          ) {
            discard(response);
            return { state: 'unavailable' };
          }
          const csv = await boundedCsv(response, controller.signal);
          if (controller.signal.aborted) return interrupted();
          return { state: 'ready', csv, hasMore: more === 'true', nextCursor: next };
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
