import { parseStoredUsageRecord } from '../usage/history.ts';
import type { UsageRecord } from '../usage/record-usage.ts';
import type { CatalogRequest } from './catalog-client.ts';

export interface UsageFilters {
  readonly principalId?: string;
  readonly model?: string;
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly limit?: number;
  readonly cursor?: string;
}
export type UsageResult =
  | {
      readonly state: 'ready';
      readonly data: readonly UsageRecord[];
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
function query(filters: UsageFilters): string | undefined {
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
  const params = new URLSearchParams({ format: 'json' });
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

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid page');
  return value as Record<string, unknown>;
}
function parsePage(value: unknown, filters: UsageFilters) {
  const page = object(value);
  if (
    page.object !== 'list' ||
    !Array.isArray(page.data) ||
    page.data.length > (filters.limit ?? 50) ||
    typeof page.has_more !== 'boolean' ||
    (page.has_more ? !validCursor(page.next_cursor) : page.next_cursor !== null) ||
    (page.has_more && page.data.length === 0)
  )
    throw new Error('Invalid page');
  const data = page.data.map(parseStoredUsageRecord);
  let previous: readonly [number, string] | undefined;
  if (filters.cursor) {
    const bytes = atob(filters.cursor.replace(/-/gu, '+').replace(/_/gu, '/'));
    previous = JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0))));
  }
  const seen = new Set<string>(previous ? [previous[1]] : []);
  const encoder = new TextEncoder();
  function compare(left: string, right: string): number {
    const a = encoder.encode(left);
    const b = encoder.encode(right);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const x = a[i];
      const y = b[i];
      if (x !== undefined && y !== undefined && x !== y) return x - y;
    }
    return a.length - b.length;
  }
  for (const row of data) {
    if (
      seen.has(row.attemptId) ||
      (previous &&
        (row.occurredAt > previous[0] ||
          (row.occurredAt === previous[0] && compare(row.attemptId, previous[1]) >= 0))) ||
      (filters.principalId !== undefined && row.principalId !== filters.principalId) ||
      (filters.model !== undefined && row.modelAlias !== filters.model) ||
      (filters.fromMs !== undefined && row.occurredAt < filters.fromMs) ||
      (filters.toMs !== undefined && row.occurredAt >= filters.toMs)
    )
      throw new Error('Invalid page');
    seen.add(row.attemptId);
    previous = [row.occurredAt, row.attemptId];
  }
  if (page.has_more) {
    const last = data.at(-1);
    const bytes = atob(String(page.next_cursor).replace(/-/gu, '+').replace(/_/gu, '/'));
    const next: unknown = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0))),
    );
    if (!Array.isArray(next) || next[0] !== last?.occurredAt || next[1] !== last?.attemptId)
      throw new Error('Invalid page');
  }
  return { data, hasMore: page.has_more, nextCursor: page.next_cursor as string | null };
}

/** One already-authorized JSON usage page. No token handling, caching, DOM or automatic download.
 * UI must invalidate on identity/session change and retain filters with opaque cursors.
 * Each new read supersedes the previous one; server remains the permission authority.
 */
export function createSsoUsageClient(request: CatalogRequest) {
  let pending: AbortController | undefined;
  function invalidate() {
    pending?.abort();
    pending = undefined;
  }
  return {
    invalidate,
    async read(filters: UsageFilters = {}): Promise<UsageResult> {
      invalidate();
      let search: string | undefined;
      let snapshot: UsageFilters;
      try {
        // Bind response validation to the exact filters serialized for this request.
        const { principalId, model, fromMs, toMs, limit, cursor } = filters;
        snapshot = {
          ...(principalId === undefined ? {} : { principalId }),
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
      const interrupted = (): UsageResult => ({
        state: timedOut ? 'unavailable' : 'cancelled',
      });
      let onAbort: (() => void) | undefined;
      const interruption = new Promise<UsageResult>((resolve) => {
        onAbort = () => resolve(interrupted());
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const operation = async (): Promise<UsageResult> => {
        try {
          const response = await request(`/management/v1/usage?${search}`, {
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
