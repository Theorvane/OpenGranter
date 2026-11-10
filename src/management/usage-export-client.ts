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
function validCursor(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/u.test(value)) return false;
  try {
    const bytes = atob(value.replace(/-/gu, '+').replace(/_/gu, '/'));
    if (btoa(bytes).replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_') !== value)
      return false;
    const decoded: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(bytes, (c) => c.charCodeAt(0)),
      ),
    );
    return (
      Array.isArray(decoded) &&
      decoded.length === 2 &&
      count(decoded[0]) &&
      typeof decoded[1] === 'string' &&
      decoded[1].trim().length > 0 &&
      decoded[1].length <= 512
    );
  } catch {
    return false;
  }
}
/** Compare validated keyset metadata only; never use decoded values to build requests. */
function advances(next: string, previous: string): boolean {
  const decode = (value: string): readonly [number, string] => {
    const bytes = atob(value.replace(/-/gu, '+').replace(/_/gu, '/'));
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(bytes, (character) => character.charCodeAt(0)),
      ),
    ) as [number, string];
  };
  const [nextTime, nextId] = decode(next);
  const [previousTime, previousId] = decode(previous);
  if (nextTime !== previousTime) return nextTime < previousTime;
  const encoder = new TextEncoder();
  const left = encoder.encode(nextId);
  const right = encoder.encode(previousId);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return (left[index] ?? 0) < (right[index] ?? 0);
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
      const submittedCursor = new URLSearchParams(search).get('cursor');
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
            (more === 'true' ? !validCursor(next) : next !== null) ||
            (more === 'true' &&
              next !== null &&
              submittedCursor !== null &&
              !advances(next, submittedCursor))
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
