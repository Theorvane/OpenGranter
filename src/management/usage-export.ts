import type { CatalogRequest } from './catalog-client.ts';
import {
  createManagementUsageClient,
  type UsageClientResult,
  type UsageFilters,
} from './usage-client.ts';

export interface FilteredUsageExportOptions {
  /** Caller MUST abort on logout, expiry, principal/policy change or navigation. */
  readonly signal: AbortSignal;
  readonly maxPages?: number;
  readonly maxBytes?: number;
  /** Whole action, never reset per page: default 60s, maximum 120s. */
  readonly maxDurationMs?: number;
}
export type FilteredUsageExportResult =
  | UsageClientResult<{ readonly csv: string; readonly pages: number; readonly bytes: number }>
  | { readonly state: 'limit_exceeded' };

/** Explicit user action only. No credential acquisition, persistence or UI mount.
 * Completion means terminal pagination, NOT a transactionally consistent snapshot.
 * No partial CSV escapes on failure. Existing server authorization/audit applies
 * independently to EVERY page; the caller owns authority teardown after success.
 */
export async function exportFilteredUsageCsv(
  request: CatalogRequest,
  filters: UsageFilters,
  options: FilteredUsageExportOptions,
): Promise<FilteredUsageExportResult> {
  const { signal, maxPages = 50, maxBytes = 8 * 1024 * 1024, maxDurationMs = 60_000 } = options;
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 100 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 8 * 1024 * 1024 ||
    !Number.isSafeInteger(maxDurationMs) ||
    maxDurationMs < 1 ||
    maxDurationMs > 120_000
  )
    return { state: 'invalid_query' };
  if (signal.aborted) return { state: 'cancelled' };
  // A dedicated client cannot cancel an independently displayed usage page.
  const client = createManagementUsageClient(request);
  const abort = () => client.invalidate();
  signal.addEventListener('abort', abort, { once: true });
  // Capture only known filters. A current-page cursor is intentionally not copied.
  const captured: UsageFilters = {
    ...(filters.principalId === undefined ? {} : { principalId: filters.principalId }),
    ...(filters.model === undefined ? {} : { model: filters.model }),
    ...(filters.requestId === undefined ? {} : { requestId: filters.requestId }),
    ...(filters.fromMs === undefined ? {} : { fromMs: filters.fromMs }),
    ...(filters.toMs === undefined ? {} : { toMs: filters.toMs }),
    ...(filters.limit === undefined ? {} : { limit: filters.limit }),
  };
  let cursor: string | undefined;
  const cursors = new Set<string>();
  const parts: string[] = [];
  let header: string | undefined;
  let bytes = 0;
  const encoder = new TextEncoder();
  const deadline = performance.now() + maxDurationMs;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    client.invalidate();
  }, maxDurationMs);
  const expired = () => timedOut || performance.now() >= deadline;
  try {
    for (let pages = 1; pages <= maxPages; pages++) {
      if (signal.aborted) return { state: 'cancelled' };
      if (expired()) return { state: 'unavailable' };
      const result = await client.csv({ ...captured, ...(cursor === undefined ? {} : { cursor }) });
      if (signal.aborted) return { state: 'cancelled' };
      if (expired()) return { state: 'unavailable' };
      if (result.state !== 'ready') return result;
      // The server emits a fixed single-line quoted header and CRLF rows. Do not
      // split data rows: quoted cells can contain CRLF and must remain byte-exact.
      const csv = result.data.csv.replace(/^\ufeff/u, '');
      const end = csv.indexOf('\r\n');
      if (end < 0 || !csv.endsWith('\r\n')) return { state: 'unavailable' };
      const pageHeader = csv.slice(0, end + 2);
      if (!/^"[^"\r\n]+"(?:,"[^"\r\n]+")*\r\n$/u.test(pageHeader)) return { state: 'unavailable' };
      if (header !== undefined && header !== pageHeader) return { state: 'unavailable' };
      header = pageHeader;
      const rows = csv.slice(end + 2);
      if (result.data.hasMore && !rows) return { state: 'unavailable' };
      const part = pages === 1 ? csv : rows;
      bytes += encoder.encode(part).byteLength;
      if (bytes > maxBytes) return { state: 'limit_exceeded' };
      parts.push(part);
      if (signal.aborted) return { state: 'cancelled' };
      if (expired()) return { state: 'unavailable' };
      if (!result.data.hasMore)
        return { state: 'ready', data: { csv: parts.join(''), pages, bytes } };
      const next = result.data.nextCursor;
      if (next === null || cursors.has(next)) return { state: 'unavailable' };
      cursors.add(next);
      cursor = next;
    }
    return { state: 'limit_exceeded' };
  } catch {
    return { state: signal.aborted ? 'cancelled' : 'unavailable' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    client.invalidate();
  }
}
